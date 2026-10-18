// Ifrim Agent Hub — Desktop Operator helper (M10). Runs in the owner's interactive session, NOT elevated, started by the Hub with
// its stdin/stdout as the only channel (no network listener, no named pipe another process could open). Every request is a JSON
// line {"body":"<json>","mac":"<hex>"}: HMAC-SHA256 with the per-start key the Hub sends in the first line, a nonce that is never
// accepted twice, a timestamp window and an expiry from the Hub's authority. The helper performs small, structural UI operations
// (Windows UI Automation first, keyboard only after the target window is verified to be in the foreground) and reports what it
// observed after each one; it never runs scripts, shells or arbitrary payloads, and refuses protected processes (credential stores,
// consoles, consent / sign-in / lock screens) and the Hub's own window. "stop" is handled on the reader thread, ahead of any queued
// work: input stops at once, held modifier keys are released, and the helper stays paused until the Hub sends "resume".
// Compiled with the .NET Framework 4.x csc (C# 5): see v2/scripts/build-operator.mjs.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace IfrimOperator
{
    public class OpError : Exception
    {
        public string Code;
        public OpError(string code, string message) : base(message) { Code = code; }
    }

    public static class Program
    {
        const string VERSION = "1.0.0-m10";
        static byte[] key;
        static string sessionId = "";
        static readonly object writeLock = new object();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
        static readonly HashSet<string> seenNonces = new HashSet<string>();
        static readonly Queue<string> nonceOrder = new Queue<string>();
        static volatile bool paused = false;
        static volatile bool cancel = false;
        static int lastInjectedTick = 0;
        static readonly Dictionary<string, AutomationElement> refs = new Dictionary<string, AutomationElement>();
        static readonly object refsLock = new object();
        static readonly Queue<Dictionary<string, object>> work = new Queue<Dictionary<string, object>>();
        static readonly object workLock = new object();

        static readonly string[] Protected = { "consent", "credentialuibroker", "logonui", "lockapp", "securityhealthsystray", "1password", "keepass", "keepassxc",
            "bitwarden", "lastpass", "dashlane", "authy desktop", "taskmgr", "regedit", "mmc", "cmd", "powershell", "pwsh", "windowsterminal", "wt", "conhost",
            "openconsole", "wsl", "bash" };
        static readonly Regex SensitiveControl = new Regex(@"\b(publish|post|share|upload|send|submit|delete|remove|erase|pay|buy|purchase|checkout|subscribe|upgrade|sign\s*in|log\s*in|publică|publica|postează|posteaza|distribuie|încarcă|incarca|trimite|șterge|sterge|elimină|elimina|plătește|plateste|cumpără|cumpara|abonează|aboneaza|autentifică|autentifica|conectează|conecteaza|export\s+to\s+(tiktok|youtube|instagram|x|facebook))\b", RegexOptions.IgnoreCase);
        static readonly Regex OwnHubTitle = new Regex(@"Ifrim Agent Hub|localhost:8011|127\.0\.0\.1:8011", RegexOptions.IgnoreCase);

        [STAThread]
        public static int Main(string[] args)
        {
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            Console.InputEncoding = new UTF8Encoding(false);
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            Console.SetOut(stdout);
            var hello = Console.ReadLine();
            if (hello == null) return 2;
            try
            {
                var h = (Dictionary<string, object>)json.DeserializeObject(hello);
                var hd = (Dictionary<string, object>)h["hello"];
                key = HexToBytes((string)hd["key"]);
                sessionId = hd.ContainsKey("session") ? Convert.ToString(hd["session"]) : "";
                if (key.Length < 32) throw new Exception("key too short");
            }
            catch (Exception e) { Console.Error.WriteLine("bad hello: " + e.Message); return 2; }
            Reply(null, "hello", new Dictionary<string, object> { { "ok", true }, { "version", VERSION }, { "pid", Process.GetCurrentProcess().Id }, { "session", sessionId } });

            var dispatcher = new Thread(DispatchLoop) { IsBackground = true, Name = "dispatcher" };
            dispatcher.SetApartmentState(ApartmentState.STA);
            dispatcher.Start();
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                Dictionary<string, object> body;
                try { body = Verify(line); }
                catch (OpError e) { Reply(null, "error", Err(e.Code, e.Message)); continue; }
                var op = Convert.ToString(body["op"]);
                var id = Convert.ToString(body["id"]);
                // Stop / release / ping are answered here, ahead of queued work.
                if (op == "stop") { cancel = true; paused = true; ReleaseAll(); lock (workLock) { work.Clear(); } Reply(id, op, Ok(new Dictionary<string, object> { { "paused", true } })); continue; }
                if (op == "releaseAll") { ReleaseAll(); Reply(id, op, Ok(new Dictionary<string, object>())); continue; }
                if (op == "ping") { Reply(id, op, Ok(new Dictionary<string, object> { { "paused", paused }, { "version", VERSION } })); continue; }
                lock (workLock) { work.Enqueue(body); Monitor.Pulse(workLock); }
            }
            cancel = true; ReleaseAll();
            return 0;
        }

        static void DispatchLoop()
        {
            while (true)
            {
                Dictionary<string, object> body;
                lock (workLock) { while (work.Count == 0) Monitor.Wait(workLock); body = work.Dequeue(); }
                var id = Convert.ToString(body["id"]);
                var op = Convert.ToString(body["op"]);
                var a = body.ContainsKey("args") && body["args"] is Dictionary<string, object> ? (Dictionary<string, object>)body["args"] : new Dictionary<string, object>();
                var auth = body.ContainsKey("auth") && body["auth"] is Dictionary<string, object> ? (Dictionary<string, object>)body["auth"] : null;
                int timeout = a.ContainsKey("timeoutMs") ? Math.Min(120000, Math.Max(100, Convert.ToInt32(a["timeoutMs"]))) : 15000;
                Dictionary<string, object> result = null;
                Exception failure = null;
                var t = new Thread(() =>
                {
                    try { result = Execute(op, a, auth); }
                    catch (Exception e) { failure = e; }
                }) { IsBackground = true };
                t.SetApartmentState(ApartmentState.STA);
                t.Start();
                if (!t.Join(timeout + 2000))
                {
                    Reply(id, op, Err("TIMEOUT", "Operația nu a răspuns la timp (furnizorul UI Automation poate fi blocat); firul a fost abandonat."));
                    continue;
                }
                if (failure != null)
                {
                    var oe = failure as OpError;
                    Reply(id, op, Err(oe != null ? oe.Code : "FAILED", oe != null ? oe.Message : failure.GetType().Name + ": " + failure.Message));
                }
                else Reply(id, op, Ok(result));
            }
        }

        // ---------------------------------------------------------------- protocol

        static Dictionary<string, object> Verify(string line)
        {
            Dictionary<string, object> env;
            try { env = (Dictionary<string, object>)json.DeserializeObject(line); }
            catch { throw new OpError("BAD_MESSAGE", "JSON invalid"); }
            if (!env.ContainsKey("body") || !env.ContainsKey("mac")) throw new OpError("BAD_MESSAGE", "lipsește body sau mac");
            var bodyText = Convert.ToString(env["body"]);
            var mac = Convert.ToString(env["mac"]);
            using (var h = new HMACSHA256(key))
            {
                var expected = BytesToHex(h.ComputeHash(Encoding.UTF8.GetBytes(bodyText)));
                if (!FixedEquals(expected, mac.ToLowerInvariant())) throw new OpError("BAD_MAC", "semnătura mesajului nu corespunde");
            }
            var body = (Dictionary<string, object>)json.DeserializeObject(bodyText);
            var nonce = Convert.ToString(body["nonce"]);
            if (string.IsNullOrEmpty(nonce) || nonce.Length < 16) throw new OpError("BAD_MESSAGE", "nonce lipsă");
            lock (seenNonces)
            {
                if (seenNonces.Contains(nonce)) throw new OpError("REPLAY", "mesaj deja primit (nonce refolosit)");
                seenNonces.Add(nonce); nonceOrder.Enqueue(nonce);
                while (nonceOrder.Count > 5000) seenNonces.Remove(nonceOrder.Dequeue());
            }
            DateTime ts;
            if (!DateTime.TryParse(Convert.ToString(body["ts"]), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out ts)
                || Math.Abs((DateTime.UtcNow - ts).TotalSeconds) > 120) throw new OpError("STALE", "mesaj prea vechi sau din viitor");
            var op = Convert.ToString(body["op"]);
            var open = op == "ping" || op == "stop" || op == "releaseAll" || op == "desktopState" || op == "inputState" || op == "resume";
            if (!open)
            {
                var auth = body.ContainsKey("auth") ? body["auth"] as Dictionary<string, object> : null;
                if (auth == null || !auth.ContainsKey("exp")) throw new OpError("NO_AUTHORITY", "operația cere autoritatea Hub-ului (plan/comandă, termen)");
                DateTime exp;
                if (!DateTime.TryParse(Convert.ToString(auth["exp"]), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out exp) || exp <= DateTime.UtcNow)
                    throw new OpError("AUTHORITY_EXPIRED", "autoritatea pentru această operație a expirat");
            }
            return body;
        }

        static void Reply(string id, string op, Dictionary<string, object> payload)
        {
            payload["id"] = id; payload["op"] = op; payload["ts"] = DateTime.UtcNow.ToString("o");
            var text = json.Serialize(payload);
            string mac;
            using (var h = new HMACSHA256(key ?? new byte[32])) mac = BytesToHex(h.ComputeHash(Encoding.UTF8.GetBytes(text)));
            var line = json.Serialize(new Dictionary<string, object> { { "body", text }, { "mac", mac } });
            lock (writeLock) { Console.Out.WriteLine(line); }
        }
        static Dictionary<string, object> Ok(Dictionary<string, object> r) { var d = new Dictionary<string, object> { { "ok", true }, { "result", r } }; return d; }
        static Dictionary<string, object> Err(string code, string message) { return new Dictionary<string, object> { { "ok", false }, { "error", new Dictionary<string, object> { { "code", code }, { "message", message } } } }; }

        // ---------------------------------------------------------------- operations

        static Dictionary<string, object> Execute(string op, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            if (op == "resume") { paused = false; cancel = false; return new Dictionary<string, object> { { "paused", false } }; }
            if (op == "desktopState") return DesktopState();
            if (op == "inputState") return InputState(a);
            if (paused && op != "listWindows" && op != "fileInfo") throw new OpError("PAUSED", "Operatorul e pe pauză (Stop / Preiau eu); Hub-ul trebuie să trimită „resume” după ce verifică starea.");
            cancel = false;
            switch (op)
            {
                case "listWindows": return new Dictionary<string, object> { { "windows", ListWindows(a) } };
                case "fileInfo": return FileInfoOf(Str(a, "path"));
                case "launch": return Launch(a, auth);
                case "waitWindow": return WaitWindow(a, auth);
                case "focus": return Focus(Hwnd(a), auth);
                case "move": return Move(Hwnd(a), a, auth);
                case "observe": return Observe(Hwnd(a), a, auth);
                case "find": return Find(Hwnd(a), a, auth);
                case "invoke": return Invoke(Hwnd(a), a, auth);
                case "setValue": return SetValue(Hwnd(a), a, auth);
                case "setFocus": return SetFocusOn(Hwnd(a), a, auth);
                case "getText": return GetText(Hwnd(a), a, auth);
                case "typeText": return TypeText(Hwnd(a), a, auth);
                case "keys": return Keys(Hwnd(a), a, auth);
                case "clickElement": return ClickElement(Hwnd(a), a, auth);
                case "explorerWindows": return new Dictionary<string, object> { { "windows", ExplorerWindows() } };
                case "discoverApps": return new Dictionary<string, object> { { "apps", DiscoverApps(a) } };
                default: throw new OpError("UNKNOWN_OP", "Operație necunoscută: " + op);
            }
        }

        static IntPtr Hwnd(Dictionary<string, object> a)
        {
            if (!a.ContainsKey("hwnd")) throw new OpError("BAD_ARGS", "lipsește hwnd");
            var h = new IntPtr(Convert.ToInt64(a["hwnd"]));
            if (!Native.IsWindow(h)) throw new OpError("WINDOW_GONE", "Fereastra nu mai există (închisă sau înlocuită).");
            return h;
        }
        static string Str(Dictionary<string, object> a, string k) { return a.ContainsKey(k) && a[k] != null ? Convert.ToString(a[k]) : null; }
        /**
         * A JSON array from JavaScriptSerializer.DeserializeObject arrives as object[] (an ArrayList only through Deserialize<T>): every
         * array is read through this one function, never with a type test that silently skips the check when the runtime type differs.
         * Returns null when the key is missing or the value is not an array (a string or an object is not a list).
         */
        static List<object> ArrOf(Dictionary<string, object> a, string k)
        {
            if (a == null || !a.ContainsKey(k) || a[k] == null || a[k] is string || a[k] is IDictionary) return null;
            var e = a[k] as IEnumerable;
            return e == null ? null : e.Cast<object>().ToList();
        }
        static List<string> LowerStrs(Dictionary<string, object> a, string k) { var l = ArrOf(a, k); return l == null ? null : l.Select(x => Convert.ToString(x).ToLowerInvariant()).ToList(); }

        /** Identity + policy check of the target window (process name, start time, protected list, the Hub's own window, scope). */
        static WindowInfo Target(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            var w = Describe(hwnd);
            if (w == null) throw new OpError("WINDOW_GONE", "Fereastra nu mai există.");
            if (Protected.Contains(w.ProcessName.ToLowerInvariant())) throw new OpError("PROTECTED_TARGET", w.ProcessName + " e o aplicație protejată; operatorul nu o atinge.");
            if (OwnHubTitle.IsMatch(w.Title ?? "")) throw new OpError("PROTECTED_TARGET", "Fereastra Hub-ului nu se operează prin desktop (comenzile trec prin serviciul de autorizare).");
            if (a.ContainsKey("pid") && Convert.ToInt32(a["pid"]) != w.Pid) throw new OpError("IDENTITY_CHANGED", "Fereastra aparține altui proces decât cel verificat (HWND refolosit?).");
            if (a.ContainsKey("procStart") && Convert.ToInt64(a["procStart"]) != w.ProcStart) throw new OpError("IDENTITY_CHANGED", "Procesul ferestrei a fost repornit de la ultima verificare.");
            // Fail-closed: an operation on a window needs the authority's list of allowed processes; a missing or malformed list
            // refuses (it never means "any application").
            if (auth != null)
            {
                var apps = LowerStrs(auth, "apps");
                if (apps == null) throw new OpError("OUT_OF_SCOPE", "Autoritatea nu numește aplicațiile permise pentru acest pas.");
                if (!apps.Contains(w.ProcessName.ToLowerInvariant())) throw new OpError("OUT_OF_SCOPE", w.ProcessName + " nu e în aplicațiile autorizate pentru acest pas.");
            }
            return w;
        }

        static void RequireInteractive()
        {
            var name = InputDesktopName();
            if (name != "Default") throw new OpError("SECURE_DESKTOP", "Ecranul e blocat sau un dialog securizat e activ (" + (name ?? "necunoscut") + "); controlul interactiv e suspendat.");
        }

        class WindowInfo { public long Hwnd; public int Pid; public string ProcessName; public string ExePath; public long ProcStart; public string Title; public string ClassName; public Native.RECT Rect; public bool Visible; public bool Minimized; public int Dpi; public long Owner; }

        static WindowInfo Describe(IntPtr hwnd)
        {
            if (!Native.IsWindow(hwnd)) return null;
            uint pid; Native.GetWindowThreadProcessId(hwnd, out pid);
            var w = new WindowInfo { Hwnd = hwnd.ToInt64(), Pid = (int)pid };
            var sb = new StringBuilder(512);
            Native.GetWindowText(hwnd, sb, sb.Capacity); w.Title = sb.ToString();
            var cb = new StringBuilder(256);
            Native.GetClassName(hwnd, cb, cb.Capacity); w.ClassName = cb.ToString();
            Native.RECT r; Native.GetWindowRect(hwnd, out r); w.Rect = r;
            w.Visible = Native.IsWindowVisible(hwnd); w.Minimized = Native.IsIconic(hwnd);
            try { w.Dpi = (int)Native.GetDpiForWindow(hwnd); } catch { w.Dpi = 96; }
            w.Owner = Native.GetWindow(hwnd, 4).ToInt64();
            var hp = Native.OpenProcess(0x1000, false, pid);
            if (hp != IntPtr.Zero)
            {
                try
                {
                    var path = new StringBuilder(1024); int size = path.Capacity;
                    if (Native.QueryFullProcessImageName(hp, 0, path, ref size)) w.ExePath = path.ToString();
                    long c, e, k, u;
                    if (Native.GetProcessTimes(hp, out c, out e, out k, out u)) w.ProcStart = c;
                }
                finally { Native.CloseHandle(hp); }
            }
            w.ProcessName = w.ExePath != null ? Path.GetFileNameWithoutExtension(w.ExePath) : "";
            return w;
        }
        static Dictionary<string, object> WindowDict(WindowInfo w)
        {
            return new Dictionary<string, object> { { "hwnd", w.Hwnd }, { "pid", w.Pid }, { "processName", w.ProcessName }, { "exePath", w.ExePath }, { "procStart", w.ProcStart },
                { "title", w.Title }, { "className", w.ClassName }, { "rect", new Dictionary<string, object> { { "x", w.Rect.Left }, { "y", w.Rect.Top }, { "w", w.Rect.Right - w.Rect.Left }, { "h", w.Rect.Bottom - w.Rect.Top } } },
                { "visible", w.Visible }, { "minimized", w.Minimized }, { "dpi", w.Dpi }, { "owner", w.Owner } };
        }

        static List<object> ListWindows(Dictionary<string, object> a)
        {
            var names = LowerStrs(a, "processNames");
            int pidFilter = a.ContainsKey("pid") ? Convert.ToInt32(a["pid"]) : 0;
            var list = new List<object>();
            Native.EnumWindows((h, l) =>
            {
                if (!Native.IsWindowVisible(h)) return true;
                int cloaked = 0;
                try { Native.DwmGetWindowAttribute(h, 14, out cloaked, 4); } catch { }
                if (cloaked != 0) return true;
                var w = Describe(h);
                if (w == null || string.IsNullOrEmpty(w.ProcessName)) return true;
                if (pidFilter != 0 && w.Pid != pidFilter) return true;
                // Only the requested processes are described (titles of other windows can be private): never a full inventory.
                if (names == null || !names.Contains(w.ProcessName.ToLowerInvariant())) return true;
                list.Add(WindowDict(w));
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static Dictionary<string, object> FileInfoOf(string path)
        {
            if (path == null || !File.Exists(path)) throw new OpError("NOT_FOUND", "Fișierul nu există.");
            var v = FileVersionInfo.GetVersionInfo(path);
            var d = new Dictionary<string, object> { { "path", path }, { "productName", v.ProductName }, { "fileVersion", v.FileVersion }, { "productVersion", v.ProductVersion }, { "company", v.CompanyName }, { "bytes", new FileInfo(path).Length } };
            try
            {
                var cert = System.Security.Cryptography.X509Certificates.X509Certificate.CreateFromSignedFile(path);
                d["signer"] = cert.Subject;
                d["signed"] = true;
                d["trusted"] = Native.VerifyTrust(path);
            }
            catch { d["signed"] = false; d["trusted"] = false; }
            return d;
        }

        static Dictionary<string, object> Launch(Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            var kind = Str(a, "kind") ?? "exe";
            int pid = 0;
            int before = Environment.TickCount;
            if (kind == "aumid")
            {
                var mgr = (IApplicationActivationManager)new ApplicationActivationManager();
                uint p;
                int hr = mgr.ActivateApplication(Str(a, "aumid"), Str(a, "arguments") ?? "", 0, out p);
                if (hr != 0) throw new OpError("LAUNCH_FAILED", "Activarea aplicației a eșuat (HRESULT 0x" + hr.ToString("X8") + ").");
                pid = (int)p;
            }
            else if (kind == "exe" || kind == "explorer")
            {
                var exe = Str(a, "exe");
                if (exe == null || !File.Exists(exe)) throw new OpError("NOT_FOUND", "Executabilul nu există: " + exe);
                if (Protected.Contains(Path.GetFileNameWithoutExtension(exe).ToLowerInvariant())) throw new OpError("PROTECTED_TARGET", "Aplicație protejată.");
                var psi = new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = Str(a, "cwd") ?? Path.GetDirectoryName(exe) };
                var argList = ArrOf(a, "args");
                if (argList != null) psi.Arguments = string.Join(" ", argList.Select(x => Quote(Convert.ToString(x))));
                var proc = Process.Start(psi);
                pid = proc.Id;
            }
            else throw new OpError("BAD_ARGS", "Tip de lansare necunoscut: " + kind);
            return new Dictionary<string, object> { { "pid", pid }, { "launchedTick", before } };
        }

        static string Quote(string s) { if (s.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return s; return "\"" + s.Replace("\"", "\\\"") + "\""; }

        static Dictionary<string, object> WaitWindow(Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            int timeout = a.ContainsKey("timeoutMs") ? Convert.ToInt32(a["timeoutMs"]) : 10000;
            var titleRe = Str(a, "titleRegex") != null ? new Regex(Str(a, "titleRegex"), RegexOptions.IgnoreCase) : null;
            var cls = Str(a, "className");
            var exclude = (ArrOf(a, "excludeHwnds") ?? new List<object>()).Select(x => Convert.ToInt64(x)).ToList();
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeout)
            {
                if (cancel) throw new OpError("STOPPED", "Oprit.");
                foreach (Dictionary<string, object> w in ListWindows(a))
                {
                    if (exclude.Contains(Convert.ToInt64(w["hwnd"]))) continue;
                    if (titleRe != null && !titleRe.IsMatch(Convert.ToString(w["title"]))) continue;
                    if (cls != null && Convert.ToString(w["className"]) != cls) continue;
                    return new Dictionary<string, object> { { "window", w }, { "waitedMs", sw.ElapsedMilliseconds } };
                }
                Thread.Sleep(150);
            }
            throw new OpError("WINDOW_NOT_FOUND", "Fereastra așteptată nu a apărut în " + timeout + " ms.");
        }

        static Dictionary<string, object> Focus(IntPtr hwnd, Dictionary<string, object> auth)
        {
            RequireInteractive();
            var w = Target(hwnd, new Dictionary<string, object>(), auth);
            if (Native.IsIconic(hwnd)) Native.ShowWindow(hwnd, 9);
            if (!Native.SetForegroundWindow(hwnd))
            {
                var fg = Native.GetForegroundWindow();
                uint dummy;
                var fgThread = Native.GetWindowThreadProcessId(fg, out dummy);
                var me = Native.GetCurrentThreadId();
                Native.AttachThreadInput(me, fgThread, true);
                Native.BringWindowToTop(hwnd); Native.SetForegroundWindow(hwnd);
                Native.AttachThreadInput(me, fgThread, false);
            }
            Thread.Sleep(120);
            var now = Native.GetForegroundWindow();
            return new Dictionary<string, object> { { "foreground", now.ToInt64() == hwnd.ToInt64() }, { "window", WindowDict(Describe(hwnd)) } };
        }

        static Dictionary<string, object> Move(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            Target(hwnd, a, auth);
            if (Native.IsIconic(hwnd)) Native.ShowWindow(hwnd, 9);
            Native.SetWindowPos(hwnd, IntPtr.Zero, Convert.ToInt32(a["x"]), Convert.ToInt32(a["y"]), Convert.ToInt32(a["w"]), Convert.ToInt32(a["h"]), 0x0004 | 0x0010);
            Thread.Sleep(150);
            return new Dictionary<string, object> { { "window", WindowDict(Describe(hwnd)) } };
        }

        // ---------------------------------------------------------------- UI Automation

        static string RefOf(AutomationElement e)
        {
            int[] rid;
            try { rid = e.GetRuntimeId(); } catch { return null; }
            var r = string.Join(".", rid.Select(x => x.ToString()).ToArray());
            lock (refsLock) { refs[r] = e; if (refs.Count > 4000) refs.Clear(); }
            return r;
        }
        static AutomationElement Resolve(IntPtr hwnd, Dictionary<string, object> a)
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (a.ContainsKey("ref"))
            {
                AutomationElement e = null;
                lock (refsLock) { refs.TryGetValue(Convert.ToString(a["ref"]), out e); }
                if (e != null)
                {
                    try { var _ = e.Current.ControlType; return e; } catch { }
                }
            }
            if (a.ContainsKey("selector") && a["selector"] is Dictionary<string, object>)
            {
                var found = FindAll(root, (Dictionary<string, object>)a["selector"], 1);
                if (found.Count > 0) return found[0];
                throw new OpError("ELEMENT_NOT_FOUND", "Elementul cerut nu există în fereastră (interfața s-a schimbat?).");
            }
            if (a.ContainsKey("ref")) throw new OpError("STALE_REF", "Referința elementului nu mai e validă; observă din nou fereastra.");
            return root;
        }
        static List<AutomationElement> FindAll(AutomationElement root, Dictionary<string, object> sel, int max)
        {
            var conds = new List<Condition>();
            if (sel.ContainsKey("automationId")) conds.Add(new PropertyCondition(AutomationElement.AutomationIdProperty, Convert.ToString(sel["automationId"])));
            if (sel.ContainsKey("className")) conds.Add(new PropertyCondition(AutomationElement.ClassNameProperty, Convert.ToString(sel["className"])));
            if (sel.ContainsKey("name")) conds.Add(new PropertyCondition(AutomationElement.NameProperty, Convert.ToString(sel["name"])));
            if (sel.ContainsKey("controlType"))
            {
                var ct = ControlTypeByName(Convert.ToString(sel["controlType"]));
                if (ct != null) conds.Add(new PropertyCondition(AutomationElement.ControlTypeProperty, ct));
            }
            Condition c = conds.Count == 0 ? Condition.TrueCondition : conds.Count == 1 ? conds[0] : new AndCondition(conds.ToArray());
            var coll = root.FindAll(TreeScope.Descendants, c);
            var re = sel.ContainsKey("nameRegex") ? new Regex(Convert.ToString(sel["nameRegex"]), RegexOptions.IgnoreCase) : null;
            var list = new List<AutomationElement>();
            foreach (AutomationElement e in coll)
            {
                if (re != null) { string n; try { n = e.Current.Name; } catch { continue; } if (!re.IsMatch(n ?? "")) continue; }
                list.Add(e);
                if (list.Count >= max) break;
            }
            return list;
        }
        static ControlType ControlTypeByName(string n)
        {
            foreach (var f in typeof(ControlType).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
                if (f.Name.Equals(n, StringComparison.OrdinalIgnoreCase)) return (ControlType)f.GetValue(null);
            return null;
        }
        static Dictionary<string, object> NodeDict(AutomationElement e, string parent, bool includeValues)
        {
            var cur = e.Current;
            var d = new Dictionary<string, object> { { "ref", RefOf(e) }, { "parent", parent }, { "controlType", cur.ControlType.ProgrammaticName.Replace("ControlType.", "") },
                { "name", Trunc(cur.Name, 120) }, { "automationId", cur.AutomationId }, { "className", cur.ClassName }, { "enabled", cur.IsEnabled }, { "offscreen", cur.IsOffscreen },
                { "isPassword", cur.IsPassword } };
            var b = cur.BoundingRectangle;
            if (!b.IsEmpty) d["rect"] = new Dictionary<string, object> { { "x", (int)b.X }, { "y", (int)b.Y }, { "w", (int)b.Width }, { "h", (int)b.Height } };
            var pats = new List<object>();
            object p;
            if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) pats.Add("Invoke");
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p))
            {
                pats.Add("Value");
                var vp = (ValuePattern)p;
                d["readOnly"] = vp.Current.IsReadOnly;
                if (includeValues && !cur.IsPassword) d["value"] = Trunc(vp.Current.Value, 200);
            }
            if (e.TryGetCurrentPattern(TextPattern.Pattern, out p)) pats.Add("Text");
            if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) pats.Add("Toggle");
            if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) pats.Add("ExpandCollapse");
            if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) pats.Add("SelectionItem");
            if (e.TryGetCurrentPattern(WindowPattern.Pattern, out p)) pats.Add("Window");
            d["patterns"] = pats;
            return d;
        }
        static string Trunc(string s, int n) { if (s == null) return ""; return s.Length <= n ? s : s.Substring(0, n) + "…"; }

        static Dictionary<string, object> Observe(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            var w = Target(hwnd, a, auth);
            int maxNodes = a.ContainsKey("maxNodes") ? Math.Min(2000, Convert.ToInt32(a["maxNodes"])) : 400;
            int maxDepth = a.ContainsKey("maxDepth") ? Math.Min(30, Convert.ToInt32(a["maxDepth"])) : 12;
            bool includeValues = a.ContainsKey("includeValues") && Convert.ToBoolean(a["includeValues"]);
            var root = AutomationElement.FromHandle(hwnd);
            var walker = TreeWalker.ControlViewWalker;
            var nodes = new List<object>();
            var queue = new Queue<Tuple<AutomationElement, string, int>>();
            queue.Enqueue(Tuple.Create(root, (string)null, 0));
            bool truncated = false;
            while (queue.Count > 0)
            {
                if (cancel) throw new OpError("STOPPED", "Oprit.");
                var item = queue.Dequeue();
                Dictionary<string, object> nd;
                try { nd = NodeDict(item.Item1, item.Item2, includeValues); } catch { continue; }
                nodes.Add(nd);
                if (nodes.Count >= maxNodes) { truncated = queue.Count > 0; break; }
                if (item.Item3 >= maxDepth) continue;
                AutomationElement child = null;
                try { child = walker.GetFirstChild(item.Item1); } catch { }
                while (child != null)
                {
                    queue.Enqueue(Tuple.Create(child, Convert.ToString(nd["ref"]), item.Item3 + 1));
                    try { child = walker.GetNextSibling(child); } catch { child = null; }
                }
            }
            string focused = null;
            try { var f = AutomationElement.FocusedElement; if (f != null) focused = RefOf(f); } catch { }
            return new Dictionary<string, object> { { "window", WindowDict(w) }, { "nodes", nodes }, { "truncated", truncated }, { "focused", focused },
                { "foreground", Native.GetForegroundWindow().ToInt64() == hwnd.ToInt64() } };
        }

        static Dictionary<string, object> Find(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            Target(hwnd, a, auth);
            var root = AutomationElement.FromHandle(hwnd);
            var sel = a.ContainsKey("selector") ? (Dictionary<string, object>)a["selector"] : new Dictionary<string, object>();
            int max = a.ContainsKey("max") ? Math.Min(50, Convert.ToInt32(a["max"])) : 10;
            var found = FindAll(root, sel, max).Select(e => (object)NodeDict(e, null, false)).ToList();
            return new Dictionary<string, object> { { "elements", found } };
        }

        static Dictionary<string, object> Invoke(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            Target(hwnd, a, auth);
            var e = Resolve(hwnd, a);
            var name = e.Current.Name ?? "";
            if (SensitiveControl.IsMatch(name)) throw new OpError("SENSITIVE_CONTROL", "„" + Trunc(name, 40) + "” are un efect extern, destructiv sau de plată; operatorul nu îl apasă.");
            if (!e.Current.IsEnabled) throw new OpError("DISABLED", "Elementul e dezactivat.");
            object p;
            var mode = Str(a, "mode") ?? "invoke";
            if (mode == "expand" && e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return Done(e, "expand"); }
            if (mode == "collapse" && e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Collapse(); return Done(e, "collapse"); }
            if (mode == "select" && e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return Done(e, "select"); }
            if (mode == "toggle" && e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return Done(e, "toggle"); }
            if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) { ((InvokePattern)p).Invoke(); return Done(e, "invoke"); }
            if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) { ((SelectionItemPattern)p).Select(); return Done(e, "select"); }
            if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) { ((TogglePattern)p).Toggle(); return Done(e, "toggle"); }
            if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ((ExpandCollapsePattern)p).Expand(); return Done(e, "expand"); }
            throw new OpError("NOT_INVOKABLE", "Elementul nu expune o acțiune structurală (Invoke/Select/Toggle/Expand).");
        }
        static Dictionary<string, object> Done(AutomationElement e, string how) { return new Dictionary<string, object> { { "how", how }, { "element", NodeDict(e, null, false) } }; }

        static Dictionary<string, object> SetValue(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            Target(hwnd, a, auth);
            var e = Resolve(hwnd, a);
            if (e.Current.IsPassword) throw new OpError("PROTECTED_FIELD", "Câmp de parolă: operatorul nu scrie în el.");
            object p;
            if (!e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) throw new OpError("NO_VALUE_PATTERN", "Câmpul nu acceptă setarea directă a valorii.");
            var vp = (ValuePattern)p;
            if (vp.Current.IsReadOnly) throw new OpError("READ_ONLY", "Câmpul e doar pentru citire.");
            vp.SetValue(Str(a, "text") ?? "");
            Thread.Sleep(60);
            return new Dictionary<string, object> { { "value", Trunc(vp.Current.Value, 400) } };
        }

        static Dictionary<string, object> SetFocusOn(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            Target(hwnd, a, auth);
            var e = Resolve(hwnd, a);
            if (e.Current.IsPassword) throw new OpError("PROTECTED_FIELD", "Câmp de parolă.");
            e.SetFocus();
            Thread.Sleep(80);
            return new Dictionary<string, object> { { "focused", NodeDict(e, null, false) } };
        }

        static Dictionary<string, object> GetText(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            Target(hwnd, a, auth);
            var e = Resolve(hwnd, a);
            if (e.Current.IsPassword) throw new OpError("PROTECTED_FIELD", "Câmp de parolă: conținutul nu se citește.");
            int max = a.ContainsKey("max") ? Math.Min(100000, Convert.ToInt32(a["max"])) : 20000;
            object p;
            if (e.TryGetCurrentPattern(TextPattern.Pattern, out p)) return new Dictionary<string, object> { { "text", ((TextPattern)p).DocumentRange.GetText(max) }, { "source", "Text" } };
            if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p)) { var v = ((ValuePattern)p).Current.Value ?? ""; return new Dictionary<string, object> { { "text", v.Length > max ? v.Substring(0, max) : v }, { "source", "Value" } }; }
            return new Dictionary<string, object> { { "text", e.Current.Name ?? "" }, { "source", "Name" } };
        }

        // ---------------------------------------------------------------- input (only after the foreground check)

        static void RequireForeground(IntPtr hwnd)
        {
            var fg = Native.GetForegroundWindow();
            if (fg.ToInt64() != hwnd.ToInt64()) throw new OpError("NOT_FOREGROUND", "Fereastra țintă nu e în prim-plan; nu tastez într-o altă fereastră.");
        }
        static void CheckUserInput(int opStartTick)
        {
            var li = new Native.LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(typeof(Native.LASTINPUTINFO));
            if (!Native.GetLastInputInfo(ref li)) return;
            int last = (int)li.dwTime;
            int injected = lastInjectedTick;
            // Real input after our last injected event (and after this operation started) = the owner intervened: suspend.
            if (last - opStartTick > 0 && last - injected > 150)
            {
                paused = true; ReleaseAll();
                throw new OpError("USER_INPUT", "Ai folosit tastatura sau mouse-ul în timpul operației; m-am oprit și aștept (Preiau eu / Continuă).");
            }
        }
        static Dictionary<string, object> TypeText(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            Target(hwnd, a, auth);
            var text = Str(a, "text") ?? "";
            if (text.Length > 20000) throw new OpError("TOO_LONG", "Text prea lung pentru tastare.");
            int start = Environment.TickCount;
            lastInjectedTick = start;
            int sent = 0;
            try
            {
                for (int i = 0; i < text.Length; i += 16)
                {
                    if (cancel) throw new OpError("STOPPED", "Oprit în timpul tastării; " + sent + " caractere trimise.");
                    RequireInteractive();
                    RequireForeground(hwnd);
                    CheckUserInput(start);
                    var chunk = text.Substring(i, Math.Min(16, text.Length - i));
                    var inputs = new List<Native.INPUT>();
                    foreach (var ch in chunk)
                    {
                        if (ch == '\r') continue;
                        if (ch == '\n') { inputs.Add(Native.Key(0x0D, false)); inputs.Add(Native.Key(0x0D, true)); continue; }
                        if (ch == '\t') { inputs.Add(Native.Key(0x09, false)); inputs.Add(Native.Key(0x09, true)); continue; }
                        inputs.Add(Native.Unicode(ch, false)); inputs.Add(Native.Unicode(ch, true));
                    }
                    if (inputs.Count > 0)
                    {
                        var n = Native.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));
                        lastInjectedTick = Environment.TickCount;
                        if (n != inputs.Count) throw new OpError("INPUT_BLOCKED", "Windows a blocat inputul (UIPI sau desktop securizat).");
                    }
                    sent += chunk.Length;
                    Thread.Sleep(15);
                }
            }
            finally { ReleaseAll(); }
            return new Dictionary<string, object> { { "typed", sent } };
        }

        static Dictionary<string, object> Keys(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            Target(hwnd, a, auth);
            RequireForeground(hwnd);
            var combo = (Str(a, "combo") ?? "").ToLowerInvariant();
            var parts = combo.Split('+');
            var mods = new List<ushort>();
            ushort main = 0;
            foreach (var part in parts)
            {
                switch (part)
                {
                    case "ctrl": mods.Add(0x11); break;
                    case "shift": mods.Add(0x10); break;
                    case "alt": mods.Add(0x12); break;
                    default: main = VkOf(part); break;
                }
            }
            if (main == 0) throw new OpError("BAD_ARGS", "Combinație de taste necunoscută: " + combo);
            var inputs = new List<Native.INPUT>();
            foreach (var m in mods) inputs.Add(Native.Key(m, false));
            inputs.Add(Native.Key(main, false)); inputs.Add(Native.Key(main, true));
            for (int i = mods.Count - 1; i >= 0; i--) inputs.Add(Native.Key(mods[i], true));
            try
            {
                var n = Native.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(Native.INPUT)));
                lastInjectedTick = Environment.TickCount;
                if (n != inputs.Count) throw new OpError("INPUT_BLOCKED", "Windows a blocat inputul (UIPI sau desktop securizat).");
            }
            finally { ReleaseAll(); }
            Thread.Sleep(120);
            return new Dictionary<string, object> { { "combo", combo } };
        }
        static ushort VkOf(string k)
        {
            if (k.Length == 1) { var c = char.ToUpperInvariant(k[0]); if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; }
            switch (k)
            {
                case "enter": return 0x0D; case "esc": case "escape": return 0x1B; case "tab": return 0x09; case "space": return 0x20; case "backspace": return 0x08;
                case "delete": return 0x2E; case "home": return 0x24; case "end": return 0x23; case "up": return 0x26; case "down": return 0x28; case "left": return 0x25; case "right": return 0x27;
                case "f2": return 0x71; case "f5": return 0x74; case "f6": return 0x75; case "f10": return 0x79;
            }
            return 0;
        }

        static Dictionary<string, object> ClickElement(IntPtr hwnd, Dictionary<string, object> a, Dictionary<string, object> auth)
        {
            RequireInteractive();
            var w = Target(hwnd, a, auth);
            RequireForeground(hwnd);
            var e = Resolve(hwnd, a);
            var name = e.Current.Name ?? "";
            if (SensitiveControl.IsMatch(name)) throw new OpError("SENSITIVE_CONTROL", "„" + Trunc(name, 40) + "” are un efect extern, destructiv sau de plată.");
            // The rectangle is read NOW (never from an older observation), the point must be inside the window and belong to it.
            var b = e.Current.BoundingRectangle;
            if (b.IsEmpty) throw new OpError("NO_RECT", "Elementul nu are poziție pe ecran.");
            int x = (int)(b.X + b.Width / 2), y = (int)(b.Y + b.Height / 2);
            Native.RECT wr; Native.GetWindowRect(hwnd, out wr);
            if (x < wr.Left || x > wr.Right || y < wr.Top || y > wr.Bottom) throw new OpError("OUTSIDE_WINDOW", "Punctul nu e în fereastra țintă.");
            var at = Native.GetAncestor(Native.WindowFromPoint(new Native.POINT { X = x, Y = y }), 2);
            if (at.ToInt64() != hwnd.ToInt64()) throw new OpError("OCCLUDED", "Altă fereastră acoperă punctul; nu dau click.");
            int vx = Native.GetSystemMetrics(76), vy = Native.GetSystemMetrics(77), vw = Native.GetSystemMetrics(78), vh = Native.GetSystemMetrics(79);
            int nx = (int)Math.Round((x - vx) * 65535.0 / Math.Max(1, vw - 1)), ny = (int)Math.Round((y - vy) * 65535.0 / Math.Max(1, vh - 1));
            var inputs = new[] { Native.Mouse(nx, ny, 0x0001 | 0x8000 | 0x4000), Native.Mouse(nx, ny, 0x0002 | 0x8000 | 0x4000), Native.Mouse(nx, ny, 0x0004 | 0x8000 | 0x4000) };
            var n = Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
            lastInjectedTick = Environment.TickCount;
            if (n != inputs.Length) throw new OpError("INPUT_BLOCKED", "Windows a blocat inputul.");
            Thread.Sleep(120);
            return new Dictionary<string, object> { { "x", x }, { "y", y }, { "element", NodeDict(e, null, false) } };
        }

        static void ReleaseAll()
        {
            var held = new ushort[] { 0x10, 0x11, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
            var ups = new List<Native.INPUT>();
            foreach (var k in held) if ((Native.GetAsyncKeyState(k) & 0x8000) != 0) ups.Add(Native.Key(k, true));
            if (ups.Count > 0) { Native.SendInput((uint)ups.Count, ups.ToArray(), Marshal.SizeOf(typeof(Native.INPUT))); lastInjectedTick = Environment.TickCount; }
        }

        // ---------------------------------------------------------------- state

        static string InputDesktopName()
        {
            var h = Native.OpenInputDesktop(0, false, 0x0001);
            if (h == IntPtr.Zero) return null;
            try
            {
                var buf = new byte[256]; uint needed;
                if (!Native.GetUserObjectInformation(h, 2, buf, (uint)buf.Length, out needed)) return null;
                return Encoding.Unicode.GetString(buf, 0, (int)Math.Max(0, needed - 2)).TrimEnd('\0');
            }
            finally { Native.CloseDesktop(h); }
        }
        static Dictionary<string, object> DesktopState()
        {
            var name = InputDesktopName();
            var fg = Native.GetForegroundWindow();
            var fw = fg != IntPtr.Zero ? Describe(fg) : null;
            return new Dictionary<string, object> { { "inputDesktop", name }, { "interactive", name == "Default" }, { "paused", paused },
                { "foregroundProcess", fw != null ? fw.ProcessName : null }, { "monitors", Native.GetSystemMetrics(80) },
                { "virtualScreen", new Dictionary<string, object> { { "x", Native.GetSystemMetrics(76) }, { "y", Native.GetSystemMetrics(77) }, { "w", Native.GetSystemMetrics(78) }, { "h", Native.GetSystemMetrics(79) } } } };
        }
        static Dictionary<string, object> InputState(Dictionary<string, object> a)
        {
            var li = new Native.LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(typeof(Native.LASTINPUTINFO));
            Native.GetLastInputInfo(ref li);
            int now = Environment.TickCount;
            return new Dictionary<string, object> { { "msSinceInput", now - (int)li.dwTime }, { "msSinceInjected", now - lastInjectedTick }, { "userInputAfterInjected", (int)li.dwTime - lastInjectedTick > 150 } };
        }

        static List<object> ExplorerWindows()
        {
            var list = new List<object>();
            var t = Type.GetTypeFromProgID("Shell.Application");
            dynamic shell = Activator.CreateInstance(t);
            try
            {
                foreach (dynamic w in shell.Windows())
                {
                    try
                    {
                        string full = w.FullName;
                        if (full == null || !full.ToLowerInvariant().EndsWith("explorer.exe")) continue;
                        string url = w.LocationURL;
                        string local = null;
                        if (!string.IsNullOrEmpty(url) && url.StartsWith("file:///")) local = new Uri(url).LocalPath;
                        list.Add(new Dictionary<string, object> { { "hwnd", (long)w.HWND }, { "path", local }, { "title", (string)w.LocationName } });
                    }
                    catch { }
                }
            }
            finally { Marshal.ReleaseComObject(shell); }
            return list;
        }

        // ---------------------------------------------------------------- discovery (standard sources only, never a disk scan)

        static List<object> DiscoverApps(Dictionary<string, object> a)
        {
            var result = new List<object>();
            var candidates = ArrOf(a, "candidates") ?? new List<object>();
            var shortcuts = StartMenuShortcuts();
            foreach (var o in candidates)
            {
                var c = o as Dictionary<string, object>;
                if (c == null || !c.ContainsKey("id")) continue;
                var id = Convert.ToString(c["id"]);
                var found = new List<object>();
                var tried = new List<string>();
                foreach (var name in Strs(c, "appPaths"))
                {
                    foreach (var hive in new[] { Microsoft.Win32.Registry.LocalMachine, Microsoft.Win32.Registry.CurrentUser })
                    {
                        try
                        {
                            using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name))
                            {
                                var v = k != null ? k.GetValue(null) as string : null;
                                if (v != null) { v = Environment.ExpandEnvironmentVariables(v.Trim('"')); tried.Add("AppPaths:" + name); if (File.Exists(v)) found.Add(Found(v, "app_paths")); }
                            }
                        }
                        catch { }
                    }
                }
                foreach (var name in Strs(c, "startMenu"))
                {
                    foreach (var s in shortcuts) if (string.Equals(s.Key, name, StringComparison.OrdinalIgnoreCase)) { tried.Add("StartMenu:" + name); if (File.Exists(s.Value)) found.Add(Found(s.Value, "start_menu")); }
                }
                foreach (var p in Strs(c, "knownPaths")) { var x = Environment.ExpandEnvironmentVariables(p); tried.Add("Known:" + x); if (File.Exists(x)) found.Add(Found(x, "known_path")); }
                var vdir = c.ContainsKey("versionedDir") ? Environment.ExpandEnvironmentVariables(Convert.ToString(c["versionedDir"])) : null;
                var vexe = c.ContainsKey("versionedExe") ? Convert.ToString(c["versionedExe"]) : null;
                if (vdir != null && vexe != null && Directory.Exists(vdir))
                {
                    // Only the app's own folder, one level: the highest version folder that holds the executable.
                    var best = Directory.GetDirectories(vdir).Select(d => new { d, v = ParseVersion(Path.GetFileName(d)) }).Where(x => x.v != null && File.Exists(Path.Combine(x.d, vexe)))
                        .OrderByDescending(x => x.v).FirstOrDefault();
                    if (best != null) found.Add(Found(Path.Combine(best.d, vexe), "versioned_dir"));
                }
                result.Add(new Dictionary<string, object> { { "id", id }, { "found", found }, { "tried", tried } });
            }
            return result;
        }
        static Version ParseVersion(string s) { Version v; return Version.TryParse(s, out v) ? v : null; }
        static IEnumerable<string> Strs(Dictionary<string, object> c, string k) { var l = ArrOf(c, k); return l == null ? new string[0] : l.Select(x => Convert.ToString(x)); }
        static Dictionary<string, object> Found(string exe, string source) { var d = FileInfoOf(exe); d["source"] = source; return d; }
        static List<KeyValuePair<string, string>> StartMenuShortcuts()
        {
            var list = new List<KeyValuePair<string, string>>();
            var roots = new[] { Environment.GetFolderPath(Environment.SpecialFolder.Programs), Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms) };
            dynamic shell = null;
            try { shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); } catch { return list; }
            foreach (var root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Directory.Exists(root)) continue;
                var files = new List<string>(Directory.GetFiles(root, "*.lnk"));
                foreach (var sub in Directory.GetDirectories(root)) { try { files.AddRange(Directory.GetFiles(sub, "*.lnk")); } catch { } }
                foreach (var f in files)
                {
                    try { dynamic sc = shell.CreateShortcut(f); string target = sc.TargetPath; if (!string.IsNullOrEmpty(target)) list.Add(new KeyValuePair<string, string>(Path.GetFileNameWithoutExtension(f), target)); }
                    catch { }
                }
            }
            try { Marshal.ReleaseComObject(shell); } catch { }
            return list;
        }

        // ---------------------------------------------------------------- helpers
        static byte[] HexToBytes(string hex) { var b = new byte[hex.Length / 2]; for (int i = 0; i < b.Length; i++) b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16); return b; }
        static string BytesToHex(byte[] b) { var sb = new StringBuilder(b.Length * 2); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }
        static bool FixedEquals(string a, string b) { if (a.Length != b.Length) return false; int diff = 0; for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i]; return diff == 0; }
    }

    [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IApplicationActivationManager
    {
        [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, int options, out uint processId);
        [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, IntPtr itemArray, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
        [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, IntPtr itemArray, out uint processId);
    }
    [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    class ApplicationActivationManager { }

    static class Native
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
        [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        static readonly IntPtr Marker = new IntPtr(0x1F0A5EED);
        public static INPUT Key(ushort vk, bool up) { var i = new INPUT { type = 1 }; i.U.ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 0x0002u : 0u, dwExtraInfo = Marker }; return i; }
        public static INPUT Unicode(char c, bool up) { var i = new INPUT { type = 1 }; i.U.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = 0x0004u | (up ? 0x0002u : 0u), dwExtraInfo = Marker }; return i; }
        public static INPUT Mouse(int x, int y, uint flags) { var i = new INPUT { type = 0 }; i.U.mi = new MOUSEINPUT { dx = x, dy = y, dwFlags = flags, dwExtraInfo = Marker }; return i; }

        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int w, int h, uint flags);
        [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
        [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
        [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
        [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "GetUserObjectInformationW")] public static extern bool GetUserObjectInformation(IntPtr h, int index, byte[] info, uint length, out uint needed);
        [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr h);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")] public static extern bool GetProcessTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);

        // WinVerifyTrust (Authenticode) — the executable's signature chain is valid and trusted on this machine.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct WINTRUST_FILE_INFO { public uint cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
        [StructLayout(LayoutKind.Sequential)] struct WINTRUST_DATA { public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice; public uint fdwRevocationChecks;
            public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference; public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings; }
        [DllImport("wintrust.dll", CharSet = CharSet.Unicode)] static extern int WinVerifyTrust(IntPtr hwnd, ref Guid action, ref WINTRUST_DATA data);
        public static bool VerifyTrust(string path)
        {
            var file = new WINTRUST_FILE_INFO { cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_FILE_INFO)), pcwszFilePath = path };
            var pFile = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WINTRUST_FILE_INFO)));
            try
            {
                Marshal.StructureToPtr(file, pFile, false);
                var data = new WINTRUST_DATA { cbStruct = (uint)Marshal.SizeOf(typeof(WINTRUST_DATA)), dwUIChoice = 2, fdwRevocationChecks = 0, dwUnionChoice = 1, pFile = pFile, dwStateAction = 0, dwProvFlags = 0x00001010 /* no revocation check, cache-only URL retrieval: never the network */ };
                var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
                return WinVerifyTrust(new IntPtr(-1), ref action, ref data) == 0;
            }
            finally { Marshal.FreeHGlobal(pFile); }
        }
    }
}

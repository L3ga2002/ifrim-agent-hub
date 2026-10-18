// M09 ffprobe normalisation (pure). ffprobe JSON varies by container and version: frame rates are rationals ("30000/1001"),
// rotation lives in a tag (old) or in the display-matrix side data (new, sign inverted), colour fields may be absent and
// cover art shows up as a video stream. The rest of the media modules only ever read this normalised shape.

const IMAGE_CONTAINERS = /(^|,)(image2|png_pipe|jpeg_pipe|webp_pipe|gif|bmp_pipe|tiff_pipe|apng|mjpeg|jpegls_pipe|gif_pipe|webp)(,|$)/i;
const IMAGE_CODECS = new Set(["png", "mjpeg", "jpegls", "webp", "gif", "bmp", "tiff", "apng"]);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = num(v); return n === null ? null : Math.trunc(n); };
const str = (v) => (typeof v === "string" && v && v !== "unknown" && v !== "N/A" ? v : null);

function gcd(a, b) { let x = Math.abs(a); let y = Math.abs(b); while (y) { [x, y] = [y, x % y]; } return x || 1; }

/** "30000/1001" | "30" | 29.97 → { num, den } reduced; null for 0/0, negative or garbage. */
export function parseRational(value) {
  if (value === null || value === undefined) return null;
  let n; let d;
  if (typeof value === "number") { if (!Number.isFinite(value) || value <= 0) return null; n = Math.round(value * 1000); d = 1000; }
  else {
    const m = /^\s*(\d+)(?:\s*[/:]\s*(\d+))?\s*$/.exec(String(value));
    if (!m) return null;
    n = Number(m[1]); d = m[2] === undefined ? 1 : Number(m[2]);
  }
  if (!(n > 0) || !(d > 0)) return null;
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

/** Rotation in degrees clockwise, normalised to 0/90/180/270. The display matrix stores the inverse (−90 = rotate 90° clockwise). */
export function rotationOf(stream) {
  let deg = null;
  for (const sd of stream?.side_data_list || []) {
    if (sd && sd.rotation !== undefined && num(sd.rotation) !== null) { deg = -num(sd.rotation); break; }
  }
  if (deg === null && stream?.tags?.rotate !== undefined && num(stream.tags.rotate) !== null) deg = num(stream.tags.rotate);
  if (deg === null) return 0;
  const r = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return r;
}

function durationMsOf(format, streams) {
  const fromFormat = num(format?.duration);
  if (fromFormat !== null && fromFormat >= 0) return Math.round(fromFormat * 1000);
  const fromStreams = streams.map((s) => num(s.duration)).filter((d) => d !== null && d >= 0);
  return fromStreams.length ? Math.round(Math.max(...fromStreams) * 1000) : null;
}

/**
 * ffprobe JSON (`-show_format -show_streams`) → `{ container, durationMs, sizeBytes, bitRate, video, audio, hasAudio, hasVideo,
 * isImage, streams }`. Cover art (attached_pic) never counts as video.
 */
export function normalizeProbe(json) {
  const format = json && typeof json === "object" && json.format && typeof json.format === "object" ? json.format : {};
  const streams = Array.isArray(json?.streams) ? json.streams.filter((s) => s && typeof s === "object") : [];
  const isCover = (s) => Number(s?.disposition?.attached_pic) === 1;
  const v = streams.find((s) => s.codec_type === "video" && !isCover(s)) || null;
  const a = streams.find((s) => s.codec_type === "audio") || null;
  const container = str(format.format_name);
  let video = null;
  if (v) {
    const fps = parseRational(v.avg_frame_rate) || parseRational(v.r_frame_rate);
    const rotation = rotationOf(v);
    const width = int(v.width); const height = int(v.height);
    const swap = rotation === 90 || rotation === 270;
    video = {
      codec: str(v.codec_name), profile: str(v.profile), width, height,
      displayWidth: swap ? height : width, displayHeight: swap ? width : height,
      fps, pixFmt: str(v.pix_fmt), rotation,
      colorSpace: str(v.color_space), colorRange: str(v.color_range), colorTransfer: str(v.color_transfer), colorPrimaries: str(v.color_primaries),
      frameCount: int(v.nb_frames), sar: str(v.sample_aspect_ratio), durationMs: num(v.duration) !== null ? Math.round(num(v.duration) * 1000) : null,
      bitRate: int(v.bit_rate),
    };
  }
  const audio = a ? {
    codec: str(a.codec_name), sampleRate: int(a.sample_rate), channels: int(a.channels), layout: str(a.channel_layout),
    durationMs: num(a.duration) !== null ? Math.round(num(a.duration) * 1000) : null, bitRate: int(a.bit_rate),
  } : null;
  const isImage = Boolean(video && (IMAGE_CONTAINERS.test(container || "") || (IMAGE_CODECS.has(video.codec) && (video.frameCount === null || video.frameCount <= 1) && !audio)));
  return {
    container, durationMs: isImage ? null : durationMsOf(format, streams), sizeBytes: int(format.size), bitRate: int(format.bit_rate),
    video, audio, hasVideo: Boolean(video), hasAudio: Boolean(audio), isImage,
    streams: streams.map((s) => ({ index: int(s.index), type: str(s.codec_type), codec: str(s.codec_name), cover: isCover(s) || undefined })),
  };
}

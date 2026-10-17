import { api } from "../api.js";
import { withReauth } from "./ownerSession.js";
import { salesApprovalAction } from "./salesAuthorityLogic.js";

export const approveSales = (options) => withReauth(salesApprovalAction(api, options));

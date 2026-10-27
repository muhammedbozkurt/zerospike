/**
 * Which locale string explains a connection-test detail or a stored status.
 * Pure, so the screen only does `t(key)`; nothing here ever sees an address.
 */
import type { NsStatus, NsTestDetail } from "./sync";

export function testDetailKey(detail: NsTestDetail): string {
  switch (detail) {
    case "ok":
      return "nightscout.testOk";
    case "empty":
      return "nightscout.testEmpty";
    case "auth":
      return "nightscout.errAuth";
    case "write_token":
      return "nightscout.errWriteToken";
    case "timeout":
      return "nightscout.errTimeout";
    case "invalid_url":
      return "nightscout.errInvalidUrl";
    case "insecure_url":
      return "nightscout.errInsecureUrl";
    case "credentials_url":
      return "nightscout.errCredentialsUrl";
    case "api_secret":
    case "bad_token":
      return "nightscout.tokenRejected";
    case "not_nightscout":
      return "nightscout.errNotNightscout";
    case "unavailable":
      return "nightscout.errUnavailable";
    case "network":
    case "rate_limited":
    default:
      return "nightscout.errUnreachable";
  }
}

/** The line under a connected server whose last pass did not go well; null when all is well. */
export function statusKey(status: NsStatus): string | null {
  switch (status) {
    case "auth":
      return "nightscout.statusAuth";
    case "network":
      return "nightscout.statusNetwork";
    case "invalid":
      return "nightscout.statusInvalid";
    case "reconnect":
      return "nightscout.statusReconnect";
    default:
      return null;
  }
}

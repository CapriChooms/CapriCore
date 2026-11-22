// SPDX-License-Identifier: GPL-3.0-only
export function gatewayFailure(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

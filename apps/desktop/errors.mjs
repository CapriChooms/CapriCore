// SPDX-License-Identifier: GPL-3.0-only
export function gatewayFailure(code, message, httpStatus) {
  return Object.assign(new Error(message), {
    code,
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
  });
}

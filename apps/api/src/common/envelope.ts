/**
 * Standard response envelope (Spec §6).
 * Success: { data, error: null }   Failure: { data: null, error: { code, message } }
 */
export const ok = <T>(data: T) => ({ data, error: null });

export const fail = (code: string, message: string) => ({ data: null, error: { code, message } });

export type SmsSender = (mobile: string, code: string) => Promise<void>;
/** A deployment can connect its own HTTPS SMS gateway; no provider is enabled by default. */
export function configuredSmsSender(): SmsSender | undefined {
  const address = process.env.SMS_GATEWAY_URL;
  const token = process.env.SMS_GATEWAY_TOKEN;
  if (!address || !token) return undefined;
  if (new URL(address).protocol !== "https:")
    throw new Error("SMS_GATEWAY_URL must use HTTPS");
  return async (mobile, code) => {
    const response = await fetch(address, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mobile, code, expiresInSeconds: 300 }),
    });
    if (!response.ok) throw new Error("SMS gateway rejected the request");
  };
}

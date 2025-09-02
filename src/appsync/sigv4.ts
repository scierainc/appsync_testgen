import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { fromIni } from "@aws-sdk/credential-providers";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

export type SigV4Options = {
  region: string;
  profile?: string;
  service?: string;
};

/** Execute a signed GraphQL POST using IAM (SigV4). */
export async function executeSigV4(
  endpoint: string,
  body: any,
  opts: SigV4Options
): Promise<any> {
  const url = new URL(endpoint);
  const credentials = opts.profile ? fromIni({ profile: opts.profile }) : defaultProvider();

  const signer = new SignatureV4({
    credentials,
    region: opts.region,
    service: opts.service ?? "appsync",
    sha256: Sha256
  });

  const request = new HttpRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: url.host
    },
    body: JSON.stringify(body)
  });

  const signed = await signer.sign(request);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: signed.headers as any,
    body: request.body as any
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as any;
}

// @aws-sdk/client-s3 is optional (B2 upload): installed only when B2 is enabled.
// This ambient fallback keeps `npm run check` honest without the package; the
// real types win whenever it is installed.
declare module "@aws-sdk/client-s3" {
  export class S3Client {
    constructor(cfg: Record<string, unknown>);
    send(cmd: unknown): Promise<unknown>;
  }
  export class PutObjectCommand {
    constructor(input: Record<string, unknown>);
  }
}

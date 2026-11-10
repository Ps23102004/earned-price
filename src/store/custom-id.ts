// custom_id ties a PayPal order to our order row and its fact snapshot: "<orderId>:<snapshotHash>". Pure.

import { createHash } from "node:crypto";

export const customIdFor = (orderId: string, snapshotHash: string): string => `${orderId}:${snapshotHash}`;

/** True only if PayPal's custom_id names this order and carries the sha256 of the stored snapshot text. */
export function verifyCustomId(customId: string | undefined, orderId: string, snapshotJson: string): boolean {
  const sep = customId?.indexOf(":") ?? -1;
  if (!customId || sep < 0) return false;
  const ourHash = createHash("sha256").update(snapshotJson, "utf8").digest("hex");
  return customId.slice(0, sep) === orderId && customId.slice(sep + 1) === ourHash;
}

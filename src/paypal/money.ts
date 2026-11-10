// Integer-cents <-> PayPal decimal string. String/integer math only.

export function toPayPalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`cents must be a non-negative safe integer, got ${cents}`);
  }
  const dollars = Math.floor(cents / 100);
  return `${dollars}.${String(cents % 100).padStart(2, "0")}`;
}

export function fromPayPalValue(value: string): number {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`invalid PayPal amount: ${JSON.stringify(value)}`);
  }
  const [dollars, frac = ""] = value.split(".");
  const cents = Number(dollars) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`PayPal amount too large: ${value}`);
  return cents;
}

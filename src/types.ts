export type Side = "BUY" | "SELL";
export type Effect = "OPEN" | "CLOSE";

export interface OptionLeg {
  underlying: string; // e.g. "SPY"
  expiration: string; // YYYY-MM-DD
  strike: number;
  optionType: "CALL" | "PUT";
  side: Side;
  effect: Effect;
  quantity: number; // contracts, positive integer
}

export interface ParsedOrder {
  legs: OptionLeg[]; // 1..4 legs, same underlying
  price: number; // net limit price per share, positive
  priceEffect: "DEBIT" | "CREDIT";
  timeInForce: "Day";
}

export interface DryRunResult {
  ok: true;
  buyingPowerChange: string | null;
  fees: string | null;
  warnings: string[];
}

export interface PlaceResult {
  orderId: string;
  status: string;
}

export interface BrokerAdapter {
  name: "tastytrade" | "robinhood";
  enabled(): boolean;
  dryRun(order: ParsedOrder): Promise<DryRunResult>;
  place(order: ParsedOrder): Promise<PlaceResult>;
}


// src/polymarketClient.ts
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { config } from "./config";

export class PolymarketClient {
  public wallet: Wallet;
  public client: ClobClient;

  constructor() {
    if (!config.PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY is not set in environment variables");
    }

    this.wallet = new Wallet(config.PRIVATE_KEY);

    this.client = new ClobClient(
      "https://clob.polymarket.com",
      137, // Polygon chain ID
      this.wallet
    );
  }

  async createAndPostOrder(
    params: {
      tokenID: string;
      price: number;
      size: number;
      side: Side.BUY | Side.SELL;
    },
    options: any = {},
    // Restrict to only allowed enum values
    orderType: OrderType.GTC | OrderType.GTD | undefined = OrderType.GTC
  ) {
    return this.client.createAndPostOrder(
      {
        tokenID: params.tokenID,
        price: params.price,
        size: params.size,
        side: params.side,
      },
      options,
      orderType
    );
  }
}
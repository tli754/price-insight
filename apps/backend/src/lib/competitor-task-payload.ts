export type ProcessShoppingPingbackPayload = {
  type: "process-shopping-pingback";
  taskId: string;
  productId: number;
};

export type ProcessProductInfoPingbackPayload = {
  type: "process-product-info-pingback";
  taskId: string;
  productId: number;
};

export type CompetitorTaskPayload =
  | ProcessShoppingPingbackPayload
  | ProcessProductInfoPingbackPayload;

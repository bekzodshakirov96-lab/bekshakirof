export type ContainerKind = "keg_30" | "keg_50";

export function calculateContainerNet(input: {
  issuedType?: ContainerKind | null;
  issuedQuantity?: number;
  returnedType?: ContainerKind | null;
  returnedQuantity?: number;
}) {
  const issuedQuantity = Number.isFinite(input.issuedQuantity) ? Math.max(0, input.issuedQuantity ?? 0) : 0;
  const returnedQuantity = Number.isFinite(input.returnedQuantity) ? Math.max(0, input.returnedQuantity ?? 0) : 0;
  return {
    keg30:
      (input.issuedType === "keg_30" ? issuedQuantity : 0) -
      (input.returnedType === "keg_30" ? returnedQuantity : 0),
    keg50:
      (input.issuedType === "keg_50" ? issuedQuantity : 0) -
      (input.returnedType === "keg_50" ? returnedQuantity : 0),
  };
}

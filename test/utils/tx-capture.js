export async function captureTx(publicClient, label, txHashOrPromise) {
  const hash =
    typeof txHashOrPromise?.then === "function"
      ? await txHashOrPromise
      : txHashOrPromise;

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  return {
    label,
    hash,
    blockNumber: receipt.blockNumber?.toString?.() ?? String(receipt.blockNumber),
    status: receipt.status,
  };
}

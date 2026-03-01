/**
 * Parse a Server-Sent Events stream, dispatching typed callbacks.
 * Returns the parsed result from the "result" event.
 */
export async function parseSSEStream<T>(
  response: Response,
  callbacks?: {
    onStage?: (data: { stage: string; message: string }) => void;
    onDetail?: (data: { key: string; value: string }) => void;
  },
): Promise<T> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (eventType === "stage" && callbacks?.onStage) {
          callbacks.onStage(data);
        } else if (eventType === "detail" && callbacks?.onDetail) {
          callbacks.onDetail(data);
        } else if (eventType === "result") {
          result = data;
        } else if (eventType === "error") {
          throw new Error(data.message);
        }
        eventType = "";
      }
    }
  }

  if (!result) throw new Error("No result received");
  return result;
}

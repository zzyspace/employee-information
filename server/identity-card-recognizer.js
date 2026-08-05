import { ProxyAgent } from "undici";

const ID_CARD_PATTERN = /^\d{17}[\dX]$/;
const CHECKSUM_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECKSUM_CODES = "10X98765432";

const EXTRACTION_PROMPT = `请识别这份中华人民共和国居民身份证正面，只提取公民身份号码。
不要猜测、补全或返回脱敏号码。严格返回 JSON：{"idCardNumber":"18位号码"}。
如果不是身份证正面，或号码有任意字符模糊不清，返回：{"idCardNumber":null}。`;

export class IdentityCardRecognitionError extends Error {
  constructor(message, { statusCode = 422 } = {}) {
    super(message);
    this.name = "IdentityCardRecognitionError";
    this.field = "idCardFront";
    this.statusCode = statusCode;
  }
}

export function isValidIdentityCardNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!ID_CARD_PATTERN.test(normalized)) return false;

  const birthDate = normalized.slice(6, 14);
  const year = Number(birthDate.slice(0, 4));
  const month = Number(birthDate.slice(4, 6));
  const day = Number(birthDate.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }

  const checksumIndex = normalized
    .slice(0, 17)
    .split("")
    .reduce((sum, digit, index) => sum + Number(digit) * CHECKSUM_WEIGHTS[index], 0) % 11;
  return normalized.at(-1) === CHECKSUM_CODES[checksumIndex];
}

export function parseIdentityCardNumber(modelText) {
  const text = String(modelText || "").trim();
  let candidate = "";
  let parsedStructuredResult = false;
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (
        Object.hasOwn(parsed, "idCardNumber") ||
        Object.hasOwn(parsed, "id_card_number")
      ) {
        parsedStructuredResult = true;
        candidate = parsed.idCardNumber ?? parsed.id_card_number ?? "";
      }
    } catch {
      candidate = "";
    }
  }
  if (!candidate && !parsedStructuredResult) {
    candidate = text.match(/(?<!\d)\d{17}[\dXx](?!\d)/)?.[0] || "";
  }
  const normalized = String(candidate).trim().toUpperCase();
  if (!isValidIdentityCardNumber(normalized)) {
    throw new IdentityCardRecognitionError(
      "无法从身份证正面识别出有效身份证号，请确认照片清晰、完整后重试。"
    );
  }
  return normalized;
}

function buildMessageContent(file) {
  const dataUrl = `data:${file.contentType};base64,${file.buffer.toString("base64")}`;
  return [
    { type: "text", text: EXTRACTION_PROMPT },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}

export function createIdentityCardRecognizer({
  baseUrl,
  apiKey,
  model,
  provider = "openai",
  proxyUrl = "",
  timeoutMs = 60_000,
  fetchImpl = fetch,
}) {
  let proxyDispatcher;
  return async function recognizeIdentityCard(file) {
    if (!apiKey || !baseUrl || !model) {
      throw new IdentityCardRecognitionError("身份证识别服务尚未配置，请联系管理员。", {
        statusCode: 503,
      });
    }

    let response;
    try {
      const requestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: buildMessageContent(file) }],
          response_format: { type: "json_object" },
          ...(provider === "qwen" ? { temperature: 0.1 } : { reasoning_effort: "none" }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (provider === "openai" && proxyUrl) {
        proxyDispatcher ||= new ProxyAgent(proxyUrl);
        requestInit.dispatcher = proxyDispatcher;
      }
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, requestInit);
    } catch (error) {
      const message = error?.name === "TimeoutError"
        ? "身份证识别超时，请稍后重试。"
        : "身份证识别服务暂时不可用，请稍后重试。";
      throw new IdentityCardRecognitionError(message, { statusCode: 502 });
    }

    if (!response.ok) {
      throw new IdentityCardRecognitionError("身份证识别服务返回异常，请稍后重试。", {
        statusCode: 502,
      });
    }

    let responseBody;
    try {
      responseBody = await response.json();
    } catch {
      throw new IdentityCardRecognitionError("身份证识别服务返回了无效结果，请稍后重试。", {
        statusCode: 502,
      });
    }
    return parseIdentityCardNumber(responseBody?.choices?.[0]?.message?.content);
  };
}

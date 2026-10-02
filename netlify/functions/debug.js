/**
 * debug.js — Netlify Function TEMPORÁRIA
 * Loga tudo que recebe para descobrir o formato real do TanStack
 */
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify({
      path: event.path,
      rawUrl: event.rawUrl,
      httpMethod: event.httpMethod,
      headers: event.headers,
      queryStringParameters: event.queryStringParameters,
      body: event.body,
      bodyParsed: (() => { try { return JSON.parse(event.body || "{}"); } catch { return "PARSE_ERROR"; } })(),
    }),
  };
};

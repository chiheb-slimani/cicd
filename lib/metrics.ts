import client from "prom-client";

type MetricsStore = {
  register: client.Registry;
  httpRequestsTotal: client.Counter<"method" | "route" | "status">;
};

declare global {
  var __cicdMetricsStore: MetricsStore | undefined;
}

function createMetricsStore(): MetricsStore {
  const register = new client.Registry();

  client.collectDefaultMetrics({
    register,
    prefix: "nextjs_",
  });

  const httpRequestsTotal = new client.Counter({
    name: "nextjs_http_requests_total",
    help: "Total number of HTTP requests served by the Next.js app",
    labelNames: ["method", "route", "status"],
    registers: [register],
  });

  return {
    register,
    httpRequestsTotal,
  };
}

export function getMetricsStore(): MetricsStore {
  if (!global.__cicdMetricsStore) {
    global.__cicdMetricsStore = createMetricsStore();
  }

  return global.__cicdMetricsStore;
}

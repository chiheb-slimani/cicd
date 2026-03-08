import { getMetricsStore } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { register, httpRequestsTotal } = getMetricsStore();

  httpRequestsTotal.inc({
    method: "GET",
    route: "/api/metrics",
    status: "200",
  });

  const metrics = await register.metrics();

  return new Response(metrics, {
    status: 200,
    headers: {
      "Content-Type": register.contentType,
      "Cache-Control": "no-store",
    },
  });
}

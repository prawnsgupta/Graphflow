import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { SimulatorView } from "@/components/simulator/simulator-view";

export const metadata: Metadata = { title: "Simulator" };

export default async function SimulatorPage() {
  const session = await requirePageSession("simulator:use");
  return <SimulatorView currentUserId={session.userId} />;
}

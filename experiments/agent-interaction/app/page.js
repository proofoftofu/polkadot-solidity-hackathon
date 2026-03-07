import PortalClient from "../components/portal-client";
import { readPortalState } from "../lib/portal-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initialState = await readPortalState();

  return <PortalClient initialState={initialState} />;
}

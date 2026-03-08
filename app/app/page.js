import PortalClient from "../components/portal-client.js";
import { getPortalSnapshot } from "../lib/domain.js";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getPortalSnapshot();
  return <PortalClient initialState={snapshot} />;
}

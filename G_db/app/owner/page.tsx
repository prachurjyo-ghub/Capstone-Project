import { GarageGate } from "../../components/garage-access";
import { OwnerWorkspace } from "../../components/owner-workspace";

export const metadata = { title: "Garage Owner" };

export default function OwnerPage() {
  return <GarageGate role="OWNER"><OwnerWorkspace /></GarageGate>;
}

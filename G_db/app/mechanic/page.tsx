import { GarageGate } from "../../components/garage-access";
import { MechanicWorkspace } from "../../components/mechanic-workspace";

export const metadata = { title: "Mechanic Workspace" };

export default function MechanicPage() {
  return <GarageGate role="MECHANIC"><MechanicWorkspace /></GarageGate>;
}

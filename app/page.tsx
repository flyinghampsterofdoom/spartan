import { getChatGPTUser } from "./chatgpt-auth";
import { SpartanApp } from "@/components/SpartanApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <SpartanApp userName={user?.displayName ?? "Justin Rawlinson"} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { Roulette } from "@/components/roulette";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Roulette />;
}

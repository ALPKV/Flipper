import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { SpeedCheck } from "@/components/video/speed-check";
export const metadata: Metadata = { title: "Speed Check" };
export default function TrackingPage() {
  return <><PageHeader eyebrow="Single delivery" title="Speed Check">Upload one short delivery. Estimate average flight speed from detected timing and your measured distance.</PageHeader><Container><SpeedCheck /></Container></>;
}

import {SPEED_CHECK} from "@/lib/features";
import {SpeedCheck} from "@/components/video/speed-check";
import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, Panel } from "@/components/ui";
export const metadata: Metadata = { title: SPEED_CHECK ? "Speed Check" : "Speed Check · In progress" };
export default function TrackingPage() {
  if(SPEED_CHECK)return <><PageHeader eyebrow="Experimental · not validated against radar" title="Speed Check">Average speed from release to bat, with its range, or a clear reason it cannot be measured.</PageHeader><Container className="py-6"><SpeedCheck/></Container></>;
  return <><PageHeader eyebrow="In progress" title="Speed Check">We’re still working on reliable bowling speed measurement.</PageHeader><Container><Panel title="Still in progress"><p className="text-sm text-slate">Speed Check is under development. Automatic measurements are not available yet.</p><Link className="mt-4 inline-block font-bold underline" href="/highlights">Back to Flipper</Link></Panel></Container></>;
}

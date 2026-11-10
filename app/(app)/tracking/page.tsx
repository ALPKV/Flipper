import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader, Panel } from "@/components/ui";
export const metadata: Metadata = { title: "Speed Check · In progress" };
export default function TrackingPage() {
  return <><PageHeader eyebrow="In progress" title="Speed Check">We’re still working on reliable bowling speed measurement.</PageHeader><Container><Panel title="Still in progress"><p className="text-sm text-slate">Speed Check is under development. Automatic measurements are not available yet.</p><Link className="mt-4 inline-block font-bold underline" href="/highlights">Back to Clip Farmer</Link></Panel></Container></>;
}

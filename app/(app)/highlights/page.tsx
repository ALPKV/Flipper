import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { Highlights } from "@/components/video/highlights";

export const metadata: Metadata = { title: "Clip Farmer" };

export default function ClipsPage() {
  return (
    <>
      <PageHeader eyebrow="Flipper video lab" title="Clip Farmer">
        Keep the genuine shots and remove the waiting. Output length follows your session, with no artificial time limit.
      </PageHeader>
      <Container>
        <Highlights />
      </Container>
    </>
  );
}

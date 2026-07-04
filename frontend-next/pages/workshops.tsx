import type { GetServerSideProps } from "next";
import WorkshopsPage from "@/pages/Workshops";
import SeoHead from "@/components/SeoHead";
import { Workshop } from "@/hooks/useWorkshops";
import { serverFetch } from "@/lib/server-api";

type WorkshopsPageProps = {
  initialWorkshops?: Workshop[];
};

export const getServerSideProps: GetServerSideProps<WorkshopsPageProps> = async () => {
  try {
    const initialWorkshops = await serverFetch<Workshop[]>("/workshops");
    return { props: { initialWorkshops } };
  } catch {
    return { props: {} };
  }
};

export default function WorkshopsRoute({ initialWorkshops }: WorkshopsPageProps) {
  return (
    <>
      <SeoHead
        title="Workshops"
        description="Explore Pink Paisa workshops for corporate teams, groups, and wellness-first communities."
        canonicalPath="/workshops"
      />
      <WorkshopsPage initialWorkshops={initialWorkshops} />
    </>
  );
}

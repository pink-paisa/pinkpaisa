import PredictionsPage from "@/pages/Predictions";
import SeoHead from "@/components/SeoHead";

export default function PredictionsRoute() {
  return (
    <>
      <SeoHead
        title="Predictions"
        description="See what Pink Paisa users are discussing and predicting right now."
        canonicalPath="/predictions"
      />
      <PredictionsPage />
    </>
  );
}

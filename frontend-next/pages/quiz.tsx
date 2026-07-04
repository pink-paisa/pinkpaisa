import WealthnessQuizPage from "@/pages/WealthnessQuiz";
import SeoHead from "@/components/SeoHead";

export default function QuizRoute() {
  return (
    <>
      <SeoHead
        title="Wealthness Quiz"
        description="Take the Pink Paisa quiz to understand your money and wellness style."
        canonicalPath="/quiz"
      />
      <WealthnessQuizPage />
    </>
  );
}

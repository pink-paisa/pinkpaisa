import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const CtaBanner = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });

  return (
    <section id="quiz" className="bg-background py-20 md:py-28">
      <div className="container mx-auto">
        <motion.div
          ref={ref}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          transition={{ staggerChildren: 0.1 }}
          className="mx-auto max-w-2xl rounded-2xl bg-primary px-8 py-14 text-center text-primary-foreground shadow-xl shadow-primary/20 md:px-14"
        >
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-2 text-sm font-semibold uppercase tracking-widest opacity-80"
          >
            Free Quiz
          </motion.p>
          <motion.h2
            variants={fadeUp}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-4 font-serif text-3xl leading-tight md:text-4xl"
          >
            What&apos;s your Wealthness Type?
          </motion.h2>
          <motion.p
            variants={fadeUp}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mb-8 max-w-md text-base leading-relaxed opacity-90"
          >
            Are you an Overthinker, a Safe Saver, or a Ready Builder? Take the
            2-minute quiz and get a personalised next-step roadmap.
          </motion.p>
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <Button
              variant="hero-outline"
              size="xl"
              className="border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary"
              asChild
            >
              <Link href="/quiz">Take the Quiz - It&apos;s Free</Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default CtaBanner;

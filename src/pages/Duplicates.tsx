import { LinesView } from "@/components/LinesView";

const Duplicates = () => (
  <LinesView
    status="duplicate"
    title="Duplicates"
    description="Lines skipped because their expense number already exists in the system or repeats within the upload."
  />
);

export default Duplicates;

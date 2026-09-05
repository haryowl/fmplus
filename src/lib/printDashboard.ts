/** Print the current dashboard as it looks on screen. Save as PDF from the print dialog. */
export function printDashboard(): void {
  const bumpCharts = () => {
    window.dispatchEvent(new Event("resize"));
  };

  const onBefore = () => {
    bumpCharts();
    window.setTimeout(bumpCharts, 30);
  };
  const onAfter = () => {
    bumpCharts();
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
  };

  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  bumpCharts();
  window.print();
}

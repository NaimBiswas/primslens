import DashboardShell from '../../components/DashboardShell.jsx';
import CodeReviewPanel from '../../components/CodeReviewPanel.jsx';

export default function CodeReviewPage() {
  return (
    <DashboardShell active="review">
      <CodeReviewPanel />
    </DashboardShell>
  );
}

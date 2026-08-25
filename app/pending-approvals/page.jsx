import DashboardShell from '../../components/DashboardShell.jsx';
import PendingApprovalsPanel from '../../components/PendingApprovalsPanel.jsx';

export default function PendingApprovalsPage() {
  return (
    <DashboardShell active="pending-approvals">
      <PendingApprovalsPanel />
    </DashboardShell>
  );
}

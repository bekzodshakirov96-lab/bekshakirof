export type AgentDifferenceBase = {
  agentId: number;
  agentName: string;
};

export type AgentComputedAmount = AgentDifferenceBase & {
  computedAmount: number;
};

export type AgentSubmittedAmount = AgentDifferenceBase & {
  submittedAmount: number;
};

export type AgentDifferenceRow = AgentDifferenceBase & {
  computedAmount: number;
  submittedAmount: number;
  difference: number;
};

/**
 * Agent-tovar va Kassa manbalari avval alohida agregatsiya qilinadi. Ularni xom
 * qatorlar holida join qilish bir kundagi N ta tovarni M ta kassa yozuviga
 * ko'paytirib, summalarni dublikat qilishi mumkin.
 */
export function buildAgentDifferenceSummary(
  baseAgents: AgentDifferenceBase[],
  computedRows: AgentComputedAmount[],
  submittedRows: AgentSubmittedAmount[],
) {
  const byAgent = new Map<number, AgentDifferenceRow>();

  const ensure = (agent: AgentDifferenceBase) => {
    const current = byAgent.get(agent.agentId);
    if (current) return current;
    const created: AgentDifferenceRow = {
      agentId: agent.agentId,
      agentName: agent.agentName,
      computedAmount: 0,
      submittedAmount: 0,
      difference: 0,
    };
    byAgent.set(agent.agentId, created);
    return created;
  };

  for (const agent of baseAgents) ensure(agent);
  for (const row of computedRows) ensure(row).computedAmount += Number(row.computedAmount || 0);
  for (const row of submittedRows) ensure(row).submittedAmount += Number(row.submittedAmount || 0);

  const agents = Array.from(byAgent.values()).map(row => ({
    ...row,
    difference: row.computedAmount - row.submittedAmount,
  })).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.agentName.localeCompare(b.agentName));

  const computedTotal = agents.reduce((sum, row) => sum + row.computedAmount, 0);
  const submittedTotal = agents.reduce((sum, row) => sum + row.submittedAmount, 0);
  const deficitTotal = agents.reduce((sum, row) => sum + Math.max(row.difference, 0), 0);
  const excessTotal = agents.reduce((sum, row) => sum + Math.max(-row.difference, 0), 0);

  return {
    computedTotal,
    submittedTotal,
    netDifference: computedTotal - submittedTotal,
    mismatchTotal: deficitTotal + excessTotal,
    deficitTotal,
    excessTotal,
    agents,
  };
}

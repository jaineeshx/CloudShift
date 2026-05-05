import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [sessionId, setSessionId] = useState(null);
  const [configMetadata, setConfigMetadata] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [wavePlan, setWavePlan] = useState(null);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  return (
    <AppContext.Provider value={{
      sessionId, setSessionId,
      configMetadata, setConfigMetadata,
      assessment, setAssessment,
      wavePlan, setWavePlan,
      migrationStatus, setMigrationStatus,
      dashboard, setDashboard
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);

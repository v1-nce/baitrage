export type CircuitBreakerState = {
  locked: boolean;
  frustration: number;
  reason?: string;
  updatedAt: string;
};

export const INITIAL_CIRCUIT_BREAKER_STATE: CircuitBreakerState = {
  locked: false,
  frustration: 0,
  updatedAt: new Date(0).toISOString()
};

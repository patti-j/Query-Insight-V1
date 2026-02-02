import { useState, useEffect, useCallback } from 'react';

export interface TourStep {
  target: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const STORAGE_KEY = 'query-insight-tour-completed';

export function useTour(steps: TourStep[]) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [hasCompletedTour, setHasCompletedTour] = useState(true);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    setHasCompletedTour(completed === 'true');
  }, []);

  const startTour = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const endTour = useCallback((markComplete = true) => {
    setIsActive(false);
    setCurrentStep(0);
    if (markComplete) {
      localStorage.setItem(STORAGE_KEY, 'true');
      setHasCompletedTour(true);
    }
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      endTour(true);
    }
  }, [currentStep, steps.length, endTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const skipTour = useCallback(() => {
    endTour(true);
  }, [endTour]);

  const resetTour = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHasCompletedTour(false);
  }, []);

  return {
    isActive,
    currentStep,
    currentStepData: steps[currentStep],
    totalSteps: steps.length,
    hasCompletedTour,
    startTour,
    endTour,
    nextStep,
    prevStep,
    skipTour,
    resetTour,
  };
}

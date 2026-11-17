import { useState } from 'react';
import { SkinPhoneApp } from './mobile/SkinPhoneApp';
import { SKINS } from './spring/engine';
import { ComparisonStage } from './studio/ComparisonStage';

export function App() {
  const qs = new URLSearchParams(window.location.search);
  const skinParam = qs.get('s');
  const embedded = qs.get('embed') === '1';
  const [showStage, setShowStage] = useState<boolean>(() => qs.get('stage') === '1');

  if (showStage && !embedded) {
    return <ComparisonStage onExitStage={() => setShowStage(false)} />;
  }

  const validSkin = SKINS.some((k) => k.id === skinParam) ? skinParam! : 'air';
  return (
    <SkinPhoneApp
      initialSkin={validSkin}
      embedded={embedded}
      onOpenStage={() => setShowStage(true)}
    />
  );
}

import { useState } from 'react';
import { SkinPhoneApp } from './mobile/SkinPhoneApp';
import { readPersistedWechatAuth } from './security/secureClient';
import { SKINS } from './spring/engine';
import { ComparisonStage } from './studio/ComparisonStage';

export function App() {
  const qs = new URLSearchParams(window.location.search);
  const skinParam = qs.get('s');
  // Only honor embed=1 when genuinely inside a same-origin showcase iframe
  const embedded = qs.get('embed') === '1' && window.self !== window.top;
  const [showStage, setShowStage] = useState<boolean>(
    () => qs.get('stage') === '1' && Boolean(readPersistedWechatAuth()?.cachedUser)
  );

  if (showStage && !embedded && Boolean(readPersistedWechatAuth()?.cachedUser)) {
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

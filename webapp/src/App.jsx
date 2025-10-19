import { useMemo, useState } from 'react';
import DataLoader from './components/DataLoader.jsx';
import WavePlot from './components/WavePlot.jsx';

const ALL_CAMPAIGNS_KEY = '__ALL_CAMPAIGNS__';

export default function App() {
  const [activeCampaignId, setActiveCampaignId] = useState(ALL_CAMPAIGNS_KEY);

  return (
    <div>
      <header>
        <h1>Wave Buoy Data Viewer</h1>
        <p className="description">
          Explore synchronized time series for wave height, wave period, direction, spread, and sea surface temperature.
        </p>
      </header>

      <DataLoader>
        {({ data, campaignIds }) => (
          <ViewerContent
            data={data}
            campaignIds={campaignIds}
            activeCampaignId={activeCampaignId}
            onCampaignChange={setActiveCampaignId}
          />
        )}
      </DataLoader>
    </div>
  );
}

function ViewerContent({ data, campaignIds, activeCampaignId, onCampaignChange }) {
  const filteredData = useMemo(() => {
    if (activeCampaignId === ALL_CAMPAIGNS_KEY) {
      return data;
    }

    return data.filter((row) => row.campaign_id === activeCampaignId);
  }, [activeCampaignId, data]);

  const hasData = filteredData.length > 0;

  return (
    <section>
      <div className="controls">
        <label htmlFor="campaign-select">Campaign</label>
        <select
          id="campaign-select"
          value={activeCampaignId}
          onChange={(event) => onCampaignChange(event.target.value)}
        >
          <option value={ALL_CAMPAIGNS_KEY}>All campaigns</option>
          {campaignIds.map((campaignId) => (
            <option key={campaignId} value={campaignId}>
              {campaignId}
            </option>
          ))}
        </select>
      </div>

      {hasData ? (
        <WavePlot data={filteredData} />
      ) : (
        <div className="loading">
          No data available for the selected campaign.
        </div>
      )}
    </section>
  );
}

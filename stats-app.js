// Global variables dynamically assigned on load
let LEAGUE_ID = ""; 
let globalPlayersDb = {};
let completeLeagueData = [];

async function initDashboard() {
    const statusDiv = document.getElementById('status');
    try {
        if (statusDiv) statusDiv.innerText = "Loading configuration setup...";
        
        // 1. Load configuration safely from central config file
        const configRes = await fetch("config.json");
        const configData = await configRes.json();
        LEAGUE_ID = configData.LEAGUE_ID;

        if (!LEAGUE_ID) {
            throw new Error("LEAGUE_ID variable missing from config.json");
        }

        if (statusDiv) statusDiv.innerText = "Loading cached player database (this can take a few seconds)...";

            // 2. Fetch data assets safely with error fallbacks
        const usersUrl = 'https://api.sleeper.app/v1/league/' + LEAGUE_ID + '/users';
        const rostersUrl = 'https://api.sleeper.app/v1/league/' + LEAGUE_ID + '/rosters';
        const masterPlayersUrl = 'public/players.json'; 

        const [usersRes, rostersRes, masterPlayersRes] = await Promise.all([
            fetch(usersUrl).catch(e => ({ json: () => [] })),
            fetch(rostersUrl).catch(e => ({ json: () => [] })),
            fetch(masterPlayersUrl).catch(e => ({ json: () => ({}) }))
        ]);

        const users = await usersRes.json();
        const rosters = await rostersRes.json();
        globalPlayersDb = await masterPlayersRes.json();

        if (statusDiv) statusDiv.innerText = "Processing standings and calculating records...";

            // Safely map standings calculation
        const sortedRostersForStandings = [...rosters].sort((a, b) => {
            const winsA = a.settings?.wins || 0;
            const winsB = b.settings?.wins || 0;
            if (winsB !== winsA) return winsB - winsA;
            const pointsA = (a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100;
            const pointsB = (b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100;
            return pointsB - pointsA;
        });

        // Map users securely to handle profiles
        const usersMap = {};
        if (Array.isArray(users)) {
            users.forEach(user => {
                if (user && user.user_id) {
                    usersMap[user.user_id] = {
                        teamName: user.metadata?.team_name || user.display_name || "Unknown Team",
                        ownerName: user.display_name || "Unknown Owner"
                    };
                }
            });
        }

        // Combine rosters with user profiles
        if (Array.isArray(rosters)) {
            completeLeagueData = rosters.map(roster => {
                if (!roster) return null;
                const owner = usersMap[roster.owner_id] || { teamName: 'Team ' + (roster.roster_id || ''), ownerName: "Unknown Owner" };
                
                const startersList = roster.starters || [];
                const taxiList = roster.taxi || [];
                const allPlayersList = roster.players || [];

                const wins = roster.settings?.wins || 0;
                const losses = roster.settings?.losses || 0;
                const ties = roster.settings?.ties || 0;
                const recordStr = ties > 0 ? (wins + '-' + losses + '-' + ties) : (wins + '-' + losses);
                
                const standingRank = sortedRostersForStandings.findIndex(r => r.roster_id === roster.roster_id) + 1;

                const playerProfiles = allPlayersList.map(id => {
                    const baseProfile = globalPlayersDb[id] || { 
                        player_id: id, 
                        first_name: "Unknown", 
                        last_name: "Player (" + id + ")", 
                        position: "N/A", 
                        team: "N/A",
                        injury_status: null
                    };
                    let slotType = "Bench";
                    let starterIndex = startersList.indexOf(id);
                    
                    if (starterIndex !== -1) {
                        slotType = "Starter";
                    } else if (taxiList.includes(id)) {
                        slotType = "Taxi";
                    }
                    return {
                        ...baseProfile,
                        slotType: slotType,
                        starterOrder: starterIndex
                    };
                });

                return {
                    rosterId: roster.roster_id,
                    teamName: owner.teamName,
                    ownerName: owner.ownerName,
                    record: recordStr,
                    rank: standingRank || 1,
                    players: playerProfiles
                };
            }).filter(Boolean);
        }

        // Sort alphabetically
        completeLeagueData.sort((a, b) => (a.teamName || "").localeCompare(b.teamName || ""));

        // Setup dropdown choices safely
        populateDropdown(completeLeagueData);
        
        // Initial render
        if (statusDiv) statusDiv.innerText = "Building user interface...";
        renderDashboard("all");
        
        // Hide loading slot cleanly on completion
        if (statusDiv) statusDiv.style.display = "none";

    } catch (error) {
        console.error("Dashboard engine critical crash:", error);
        if (statusDiv) statusDiv.innerText = "Error loading metrics! Check browser console tools.";
    }
}

function populateDropdown(teams) {
    const select = document.getElementById('team-select');
    if (!select) return; // Guard clause stops crash if HTML element ID is mismatched
    
    select.innerHTML = '<option value="all">-- All Teams --</option>';
    
    teams.forEach(team => {
        if (!team) return;
        const opt = document.createElement('option');
        opt.value = team.rosterId;
        opt.text = team.teamName + " (" + team.ownerName + ") [Rank: #" + team.rank + "]";
        select.appendChild(opt);
    });
    select.disabled = false;
    select.onchange = (e) => renderDashboard(e.target.value);
}

function renderDashboard(filterValue) {
    const container = document.getElementById('dashboard-container');
    if (!container) return;
    container.innerHTML = ""; 

    const teamsToDisplay = filterValue === "all" 
        ? completeLeagueData 
        : completeLeagueData.filter(t => t && t.rosterId.toString() === filterValue);

    teamsToDisplay.forEach(team => {
        if (!team) return;

        const section = document.createElement('div');
        section.className = 'team-section';

        const title = document.createElement('div');
        title.className = 'team-title';
        title.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 8px;">
                <span><strong>${team.teamName}</strong> <small style="font-size: 13px; color: var(--text-muted); font-weight: normal;">(${team.ownerName})</small></span>
                <span style="font-size: 13px; background: #e2e8f0; color: #334155; padding: 4px 12px; border-radius: 20px; font-weight: 600;">Rank: #${team.rank} (${team.record})</span>
            </div>
        `;
        section.appendChild(title);

        const starters = team.players.filter(p => p.slotType === "Starter").sort((a, b) => a.starterOrder - b.starterOrder);
        const bench = team.players.filter(p => p.slotType === "Bench").sort((a, b) => (a.position || "").localeCompare(b.position || ""));
        const taxi = team.players.filter(p => p.slotType === "Taxi").sort((a, b) => (a.position || "").localeCompare(b.position || ""));

        const createSubSection = (label, playerArray, badgeClass) => {
            if (playerArray.length === 0) return;

            const subHeader = document.createElement('h4');
            subHeader.style.margin = "20px 0 10px 0";
            subHeader.style.color = "var(--text-muted)";
            subHeader.style.fontSize = "0.9rem";
            subHeader.style.textTransform = "uppercase";
            subHeader.style.letterSpacing = "0.05em";
            subHeader.innerText = label;
            section.appendChild(subHeader);

            const grid = document.createElement('div');
            grid.className = 'roster-grid';

            playerArray.forEach(player => {
                const card = document.createElement('div');
                let injuryClass = "";
                const statusLower = (player.injury_status || "").toLowerCase();
                
                if (statusLower === "out") injuryClass = "injury-out";
                else if (statusLower === "questionable") injuryClass = "injury-questionable";
                else if (statusLower === "ir" || statusLower === "injured") injuryClass = "injury-ir";
                else if (statusLower === "doubtful") injuryClass = "injury-doubtful";

                card.className = 'player-card ' + injuryClass;
                card.onclick = () => openModal(player.player_id);

                const pos = player.position || 'N/A';
                let posColor = '#64748b';
                if (pos === 'QB') posColor = '#dc2626';      
                else if (pos === 'RB') posColor = '#2563eb'; 
                else if (pos === 'WR') posColor = '#16a34a'; 
                else if (pos === 'TE') posColor = '#ea580c'; 
                else if (pos === 'K') posColor = '#7c3aed';  
                else if (pos === 'DEF') posColor = '#4b5563'; 

                const fullName = (player.first_name || '') + ' ' + (player.last_name || '');
                
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
                        <div class="player-name">${fullName}</div>
                        <span style="background: ${posColor}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; min-width: 32px; text-align: center;">${pos}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px; width: 100%;" class="player-meta">
                        <span>${player.team || 'FA'} — <span class="slot-badge ${badgeClass}">${player.slotType}</span></span>
                        ${player.injury_status ? `<b style="color: #dc2626; font-size: 11px;">[${player.injury_status}]</b>` : ''}
                    </div>
                `;
                grid.appendChild(card);
            });
            section.appendChild(grid);
        };

        createSubSection("Starters Lineup", starters, "badge-starter");
        createSubSection("Bench Depth", bench, "badge-bench");
        createSubSection("Taxi Squad", taxi, "badge-taxi");

        container.appendChild(section);
    });
}

// Modal Functionality for Detailed Stats View
function openModal(playerId) {
    const player = globalPlayersDb[playerId];
    if (!player) return;

    const positionRank = player.fantasy_positions_rankings || player.search_rank || "N/A";
    const pos = player.position || "N/A";
    const explicitRankText = positionRank !== "N/A" ? (pos + positionRank) : "N/A";
    const projectedPPR = player.fantasy_points_ppr || player.projected_points || "N/A";

    const nameElem = document.getElementById('modal-name');
    const posElem = document.getElementById('modal-pos');
    const teamElem = document.getElementById('modal-team');
    const statusElem = document.getElementById('modal-status-txt');
    const injuryElem = document.getElementById('modal-injury');
    const rankElem = document.getElementById('modal-rank');
    const projPprElem = document.getElementById('modal-proj-ppr');

    if (nameElem) nameElem.innerText = (player.first_name || '') + ' ' + (player.last_name || '');
    if (posElem) posElem.innerText = pos;
    if (teamElem) teamElem.innerText = player.team || 'Free Agent';
    if (statusElem) statusElem.innerText = player.status || 'Active';
    if (injuryElem) injuryElem.innerText = player.injury_status || 'Healthy';
    if (rankElem) rankElem.innerText = explicitRankText;
    if (projPprElem) projPprElem.innerText = projectedPPR;

    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('stats-modal');
    if (overlay) overlay.classList.add('show');
    if (modal) modal.classList.add('show');
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('stats-modal');
    if (overlay) overlay.classList.remove('show');
    if (modal) modal.classList.remove('show');
}

// Boot up dashboard logic once DOM assets are parsed safely into window memory
window.addEventListener('DOMContentLoaded', initDashboard);

import type {Member,State} from './domain';
import {AppError} from './store';
import {businessTeamData,businessTeamHeader,ungroupedBusinessTeam} from './business-team-scope';

/** Validate an optional export display scope after the export's normal authorization. */
export function requestedExportBusinessTeam(s:State,m:Member,req:Request){
 const teamId=(req.headers.get(businessTeamHeader)||'').trim();
 if(!teamId)return '';
 if(teamId.length>160)throw new AppError('业务小组筛选编号无效。');
 if(teamId!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(team=>team.id===teamId))throw new AppError('业务小组不存在或不在可见客户范围内。',403);
 return teamId;
}

-- SPDX-License-Identifier: GPL-3.0-only
-- Fixed operations through Blackmagic's installed interpreter. No preferences,
-- project loading/deletion, arbitrary scripts or filesystem commands are exposed.
local function quote(s)
  return '"'..tostring(s):gsub('[%z\1-\31\\"]',function(c)
    if c=='"' or c=='\\' then return '\\'..c end
    return string.format('\\u%04x',string.byte(c))
  end)..'"'
end
local function json(v)
  if v==nil then return 'null' end
  if type(v)=='string' then return quote(v) end
  if type(v)=='boolean' or type(v)=='number' then return tostring(v) end
  local a,object={},false
  for k,_ in pairs(v) do if type(k)~='number' then object=true end end
  if object then for k,x in pairs(v) do a[#a+1]=quote(k)..':'..json(x) end;return '{'..table.concat(a,',')..'}' end
  for _,x in ipairs(v) do a[#a+1]=json(x) end;return '['..table.concat(a,',')..']'
end
local function run()
  local q=dofile(arg[1])
  local r=(bmd and bmd.scriptapp and bmd.scriptapp('Resolve')) or (Resolve and Resolve())
  if not r then return {available=false} end
  local manager=r:GetProjectManager()
  local p=manager:GetCurrentProject()
  if not p then return {available=false} end
  local id=p:GetUniqueId()
  if q.operation~='inspect' and id~=q.projectId then error('The active project changed before editing.') end
  local pool=p:GetMediaPool()
  local clips,byId={},{}
  local function scan(folder,depth)
    if depth>8 then return end
    for _,c in ipairs(folder:GetClipList() or {}) do
      if #clips<200 then local frames=tonumber(c:GetClipProperty('Frames')) or 0;local cid=c:GetUniqueId();clips[#clips+1]={id=cid,name=c:GetName(),frames=frames};byId[cid]={item=c,frames=frames} end
    end
    for _,f in ipairs(folder:GetSubFolderList() or {}) do if #clips<200 then scan(f,depth+1) end end
  end
  scan(pool:GetRootFolder(),0)
  if q.operation=='assemble' then
    if type(q.clips)~='table' or #q.clips<1 or #q.clips>50 then error('Invalid clip ranges.') end
    for i=1,p:GetTimelineCount() do if p:GetTimelineByIndex(i):GetName()==q.timelineName then error('A timeline with this name already exists. Nothing was overwritten.') end end
    local ranges={}
    for _,c in ipairs(q.clips) do
      local source=byId[c.clipId]
      if not source or c.startFrame<0 or c.endFrame<c.startFrame or c.endFrame>=source.frames then error('The source clip or its frame range changed.') end
      ranges[#ranges+1]={mediaPoolItem=source.item,startFrame=c.startFrame,endFrame=c.endFrame+1}
    end
    local timeline=pool:CreateEmptyTimeline(q.timelineName)
    if not timeline or not p:SetCurrentTimeline(timeline) then error('The new timeline was not confirmed. Inspect Resolve before retrying.') end
    local offset=timeline:GetStartFrame()
    for _,range in ipairs(ranges) do
      range.recordFrame=offset
      if not pool:AppendToTimeline({range}) then error('A clip could not be appended. Inspect the partial new timeline before retrying.') end
      offset=offset+range.endFrame-range.startFrame
    end
    if not manager:SaveProject() then error('The new timeline could not be saved.') end
  elseif q.operation~='inspect' then error('Unsupported Resolve operation.') end
  local t=p:GetCurrentTimeline()
  local timeline=nil
  if t then
    local segments={}
    for _,item in ipairs(t:GetItemListInTrack('video',1) or {}) do if #segments<50 then local media=item:GetMediaPoolItem();segments[#segments+1]={name=item:GetName(),clipId=media and media:GetUniqueId(),sourceStart=item:GetLeftOffset(),start=item:GetStart(),finish=item:GetEnd(),duration=item:GetDuration()} end end
    local audio={}
    for _,item in ipairs(t:GetItemListInTrack('audio',1) or {}) do if #audio<50 then audio[#audio+1]={name=item:GetName(),start=item:GetStart(),finish=item:GetEnd(),duration=item:GetDuration()} end end
    timeline={name=t:GetName(),start=t:GetStartFrame(),duration=t:GetEndFrame()-t:GetStartFrame(),segments=segments,audioSegments=audio}
  end
  local summary='Resolve project: '..p:GetName()
  if timeline then summary=summary..'; timeline '..timeline.name..', '..#timeline.segments..' video segments, '..timeline.duration..' frames.' end
  return {available=true,projectId=id,projectName=p:GetName(),clips=clips,timeline=timeline,summary=summary}
end
local ok,result=pcall(run)
if not ok then result={available=false,error=tostring(result)} end
print('CAPRI_RESOLVE_RESULT:'..json(result))

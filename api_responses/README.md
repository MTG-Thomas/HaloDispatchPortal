# User Steps in Halo

## Overview

Here are the steps we take in Halo and the endpoints we hit. I have example JSON files in the directory for every endpoint. For example, ClientCache = 1_ClientCache.json.

## 1. After Login

Immediately get ClientCache from https://gocovi.halopsa.com/api/ClientCache?iscachebuild=true. This seems to container the ticketareas. My guess is that when a user logs in, we should prompt them to select an area and offer an "Switch Area" button since this informs the rest of the flow.


## 2. Select Area

When we select an area, we hit this endpoint: https://gocovi.halopsa.com/api/viewlists?showcounts=true&domain=reqs&type=reqs&ticketarea_id=1&utcoffset=300

Lists are basically predefined filters for tickets. Lists can be grouped. I can't decide how I want this to look, but one of my biggest problems with Halo is that you can have multiple lists, but I really miss a single "master list" like in ConnectWise that we were supposed to manage to 0. I'd like to have a tab per group but be able to select multiple lists and have the first column be the list's name. That will require selecting ONE column profile, though, so I think we'll need to let the user pick their "primary" list and then we essentially use that list's column_profile_id for everything,

## 3. View Filter

https://gocovi.halopsa.com/api/ViewFilter?type=reqs&ticketarea_id=1

I don't think we need to call this as the filter ID should be in the list itself, but this is the list of filters with their names.

## 4. Tickets


https://gocovi.halopsa.com/api/Tickets?pageinate=true&page_size=100&page_no=1&columns_id=15&includecolumns=true&cf_display_values_only=true&view_id=0&ticketarea_id=1&includelastnote=true&includehoversummary=true&includechildread=true&fetchgrandchildren=false&list_id=75&utcoffset=300

This is where it gets a little goofy. So we do get a list of tickets in { tickets: [] }, but we also have a list of columns in { column: [] }. This shows which columns to display in the table. For now, I just want the following columns:

ID
Client/Site/User (client_name, site_name, user_name joined by a '/')
Status
SLA Time Left (differnce between now and fixbydate I think), "On Hold" if onhold = true
Priority (priority.name preceded by a little square using priority.color).
Team
Agent with photo
    (user agent_id to lookup from ClientCache.agents {id, name})
    if agent.agentphotopath exists, it's basically the HaloResourceServer (company.halopsa.com/api + agentphotopath, this returns the agent's profile image). Use placeholder if not exist.
Summary
Date Reported (dateoccurred)
Last Action Date (lastactiondate)
Type
    Lookup with the tickettype_id from ClientCache
Time Taken (timetaken)
Service Category (category_1)
Created By (reportedby)
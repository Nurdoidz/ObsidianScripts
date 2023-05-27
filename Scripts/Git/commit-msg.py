#!/usr/bin/env python

from datetime import datetime
import os
import sys
import re
import webbrowser
import time

chishiki_path = os.environ.get('Ndz', 'C:\\Ndz') + '\\Chishiki'
daily_path = chishiki_path + '\\Periodic\\Daily\\' + datetime.now().strftime('%Y-%m-%d') + '.md'
gitmd_path = chishiki_path + '\\Journal\\☄️ Git.md'
csv_path = chishiki_path + '\\Journal\\CSV\\Git.csv'

def get_commit_message():
    with open(sys.argv[1], 'r') as file:
        return file.readlines(1)[0].strip()

fields = {
    'Date': datetime.now().strftime('%Y-%m-%d'),
    'Time': datetime.now().strftime('%H:%M:%S'),
    'System': os.environ.get('COMPUTERNAME'),
    'Project': re.search(r'\\([^\\]+?$)', os.getcwd()).group(1),
    'Commit': get_commit_message()
}

def format_fields():
    return fields['Time'] + ' **' + fields['System'] + '** - ☄️ _[[' + fields['Project'] + ']]_ - ' + fields['Commit']

def get_repo_name():
    if not os.path.isfile(os.getcwd() + '\\.git\\description'):
        return False
    with open(os.getcwd() + '\\.git\\description', 'r') as file:
        line = file.readline().strip()
    if 'Unnamed repository' in line:
        return False
    else:
        return line

def export_daily():
    if not os.path.isfile(daily_path):
        webbrowser.open('obsidian://actions-uri/daily-note/create?vault=chishiki&silent=true')
        tries = 0
        success = False
        while tries < 10:
            time.sleep(3)
            if os.path.isfile(daily_path):
                success = True
                break
            tries += 1
        if not success:
            print('Failed to write to daily note')
    try:
        with open(daily_path, 'a', encoding='utf-8') as file:
            file.write('\n' + format_fields())
    except IOError:
        print('Failed to open daily note')

def export_csv():
    add_headers = False
    if not os.path.isfile(csv_path):
        add_headers = True
    try:
        with open(csv_path, 'a', encoding='utf-8') as file:
            if add_headers:
                file.write(','.join(fields.keys()) + '\n')
            file.write('"' + '","'.join(fields.values()) + '"\n')
    except IOError:
        print('Failed to open csv file')

def export_commitmd():
    if not os.path.isfile(gitmd_path):
        try:
            file = open(gitmd_path, 'w', encoding='utf-8')
            file.close()
        except IOError:
            print('Failed to create Commit.md file')
            return
    try:
        with open(gitmd_path, 'r', encoding='utf-8') as file:
            content = ''.join(file.readlines())
        header = '\n# [[' + fields['Date'] + ']]\n\n'
        content = content.replace(header, '')
        content = header + fields['Date'] + ' ' + format_fields() + '\n' + content
        with open(gitmd_path, 'w', encoding='utf-8') as file:
            file.write(content)
    except IOError:
        print('Failed to open Commit.md file')

def main():
    repo_name = get_repo_name()
    if repo_name:
        fields['Project'] = repo_name
    
    export_daily()
    export_csv()
    export_commitmd()
    
    sys.exit(0)

if __name__ == '__main__':
    main()
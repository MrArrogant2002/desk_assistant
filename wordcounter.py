def count_words(filename):
 with open(filename) as f:
 words = f.read().split()
 return len(words)